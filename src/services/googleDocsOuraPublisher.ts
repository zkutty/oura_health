import { google } from 'googleapis';
import { OuraDailyExport } from './ouraExportService';

export interface GoogleDocsOuraPublishResult {
  documentId: string;
  url: string;
  updated: boolean;
}

interface TextRun {
  startIndex: number;
  endIndex: number;
  content: string;
}

interface OuraDocumentEntry {
  date: string;
  startIndex: number;
  endIndex: number;
  text: string;
}

export class GoogleDocsOuraPublisher {
  private readonly documentId = process.env.GOOGLE_OURA_DOCUMENT_ID;
  private readonly serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  private readonly serviceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  isConfigured(): boolean {
    return Boolean(this.documentId && (
      (this.serviceAccountEmail && this.serviceAccountPrivateKey) ||
      process.env.GOOGLE_USE_APPLICATION_DEFAULT_CREDENTIALS === 'true'
    ));
  }

  async publish(record: OuraDailyExport): Promise<GoogleDocsOuraPublishResult | null> {
    if (!this.isConfigured()) return null;

    const scopes = ['https://www.googleapis.com/auth/documents'];
    const auth = this.serviceAccountEmail && this.serviceAccountPrivateKey
      ? new google.auth.JWT({
          email: this.serviceAccountEmail,
          key: this.serviceAccountPrivateKey,
          scopes,
        })
      : new google.auth.GoogleAuth({ scopes });
    const docs = google.docs({ version: 'v1', auth });
    const document = (await docs.documents.get({ documentId: this.documentId! })).data;
    const entry = this.formatEntry(record);
    const existingEntries = this.findAllEntries(document);
    const updated = existingEntries.some(existing => existing.date === record.date);
    const sortedEntries = existingEntries
      .filter(existing => existing.date !== record.date)
      .map(existing => ({ date: existing.date, text: this.ensureTrailingNewline(existing.text) }));
    sortedEntries.push({ date: record.date, text: entry });
    sortedEntries.sort((left, right) => right.date.localeCompare(left.date));

    const insertionIndex = existingEntries.length > 0
      ? Math.min(...existingEntries.map(existing => existing.startIndex))
      : this.getDocumentEndIndex(document);
    const combinedText = sortedEntries.map(existing => existing.text).join('');
    const requests: any[] = [];

    for (const existing of [...existingEntries].sort((left, right) => right.startIndex - left.startIndex)) {
      requests.push({
        deleteContentRange: { range: { startIndex: existing.startIndex, endIndex: existing.endIndex } },
      });
    }
    requests.push({ insertText: { location: { index: insertionIndex }, text: combinedText } });

    let entryStart = insertionIndex;
    for (const sortedEntry of sortedEntries) {
      const titleStart = entryStart + this.openMarker(sortedEntry.date).length + 1;
      const titleEnd = titleStart + `Oura Daily Summary: ${sortedEntry.date}`.length + 1;
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: titleStart, endIndex: titleEnd },
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          fields: 'namedStyleType',
        },
      });
      entryStart += sortedEntry.text.length;
    }

    await docs.documents.batchUpdate({ documentId: this.documentId!, requestBody: { requests } });
    return {
      documentId: this.documentId!,
      url: `https://docs.google.com/document/d/${this.documentId}/edit`,
      updated,
    };
  }

  private formatEntry(record: OuraDailyExport): string {
    const value = (item: number | string | undefined) => item ?? 'unavailable';
    const missing = record.derived.missing_sections.length > 0 ? record.derived.missing_sections.join(', ') : 'none';
    return [
      this.openMarker(record.date),
      `Oura Daily Summary: ${record.date}`,
      '',
      `Sleep: ${value(record.scores.sleep)}`,
      `Readiness: ${value(record.scores.readiness)}`,
      `Activity: ${value(record.scores.activity)}`,
      `Resilience: ${value(record.scores.resilience_level)}`,
      '',
      `Sleep duration (minutes): ${value(record.contributors.sleep_duration_minutes)}`,
      `Deep sleep (minutes): ${value(record.contributors.deep_sleep_minutes)}`,
      `REM sleep (minutes): ${value(record.contributors.rem_sleep_minutes)}`,
      `Sleep efficiency: ${value(record.contributors.sleep_efficiency)}`,
      `Resting heart rate: ${value(record.contributors.resting_heart_rate)}`,
      `Temperature deviation: ${value(record.contributors.temperature_deviation)}`,
      `HRV balance: ${value(record.contributors.hrv_balance)}`,
      `Steps: ${value(record.contributors.steps)}`,
      `Missing sections: ${missing}`,
      '',
      `Machine data: ${JSON.stringify(record)}`,
      this.closeMarker(record.date),
      '',
    ].join('\n');
  }

  private findEntryRange(document: any, date: string): { startIndex: number; endIndex: number } | undefined {
    const runs = this.getTextRuns(document);
    const openMarker = this.openMarker(date);
    const closeMarker = this.closeMarker(date);
    const open = this.findRunContaining(runs, openMarker);
    if (!open) return undefined;
    const close = this.findRunContaining(runs.slice(open.runIndex), closeMarker);
    if (!close) throw new Error(`Oura entry for ${date} is missing its closing marker.`);

    const endAfterMarker = close.startIndex + close.offset + closeMarker.length;
    const trailingNewline = close.content.slice(close.offset + closeMarker.length).startsWith('\n') ? 1 : 0;
    return { startIndex: open.startIndex + open.offset, endIndex: endAfterMarker + trailingNewline };
  }

  private findAllEntries(document: any): OuraDocumentEntry[] {
    const runs = this.getTextRuns(document);
    const dates = new Set<string>();
    for (const run of runs) {
      for (const match of run.content.matchAll(/\[oura:(\d{4}-\d{2}-\d{2})\]/g)) {
        dates.add(match[1]);
      }
    }

    return [...dates].map(date => {
      const range = this.findEntryRange(document, date);
      if (!range) throw new Error(`Could not resolve the marked Oura entry for ${date}.`);
      return {
        date,
        ...range,
        text: this.getTextForRange(runs, range.startIndex, range.endIndex),
      };
    }).sort((left, right) => left.startIndex - right.startIndex);
  }

  private getTextForRange(runs: TextRun[], startIndex: number, endIndex: number): string {
    return runs.map(run => {
      const overlapStart = Math.max(startIndex, run.startIndex);
      const overlapEnd = Math.min(endIndex, run.endIndex);
      if (overlapStart >= overlapEnd) return '';
      return run.content.slice(overlapStart - run.startIndex, overlapEnd - run.startIndex);
    }).join('');
  }

  private ensureTrailingNewline(text: string): string {
    return text.endsWith('\n') ? text : `${text}\n`;
  }

  private getTextRuns(document: any): TextRun[] {
    return (document.body?.content ?? []).flatMap((element: any) =>
      (element.paragraph?.elements ?? [])
        .filter((part: any) => part.textRun?.content)
        .map((part: any) => ({ startIndex: part.startIndex, endIndex: part.endIndex, content: part.textRun.content as string }))
    );
  }

  private findRunContaining(runs: TextRun[], marker: string): { runIndex: number; startIndex: number; offset: number; content: string } | undefined {
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const run = runs[runIndex];
      const offset = run.content.indexOf(marker);
      if (offset !== -1) return { runIndex, startIndex: run.startIndex, offset, content: run.content };
    }
    return undefined;
  }

  private getDocumentEndIndex(document: any): number {
    const endIndex = (document.body?.content ?? []).at(-1)?.endIndex;
    if (!endIndex) throw new Error('Google Doc has no writable body content.');
    return endIndex - 1;
  }

  private openMarker(date: string): string {
    return `[oura:${date}]`;
  }

  private closeMarker(date: string): string {
    return `[/oura:${date}]`;
  }
}
