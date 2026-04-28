import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

export interface SheetsAuthOptions {
  /** Path to a Google service account JSON key file. */
  keyFilePath?: string;
  /** Raw JSON string of a Google service account key (overrides keyFilePath). */
  keyJson?: string;
}

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

/**
 * Thin wrapper around the Google Sheets API for the Oura → Sheets pipeline.
 *
 * Provides idempotent upsert (find row by key column, update in place; otherwise
 * append) so daily sync jobs can re-run without producing duplicates.
 */
export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets | null = null;
  private auth: any = null;
  private readonly options: SheetsAuthOptions;

  constructor(options?: SheetsAuthOptions) {
    this.options = {
      keyFilePath: options?.keyFilePath ?? process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      keyJson: options?.keyJson ?? process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON,
    };
  }

  private async getClient(): Promise<sheets_v4.Sheets> {
    if (this.sheets) return this.sheets;

    let credentials: Record<string, any> | undefined;
    if (this.options.keyJson) {
      credentials = JSON.parse(this.options.keyJson);
    } else if (this.options.keyFilePath) {
      const resolved = path.isAbsolute(this.options.keyFilePath)
        ? this.options.keyFilePath
        : path.resolve(process.cwd(), this.options.keyFilePath);
      credentials = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    } else {
      throw new Error(
        'Google service account credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_KEY_JSON.'
      );
    }

    this.auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    return this.sheets;
  }

  /** Returns service-account email from credentials, useful for setup messaging. */
  getServiceAccountEmail(): string | null {
    try {
      if (this.options.keyJson) return JSON.parse(this.options.keyJson).client_email ?? null;
      if (this.options.keyFilePath) {
        const resolved = path.isAbsolute(this.options.keyFilePath)
          ? this.options.keyFilePath
          : path.resolve(process.cwd(), this.options.keyFilePath);
        return JSON.parse(fs.readFileSync(resolved, 'utf-8')).client_email ?? null;
      }
    } catch {
      return null;
    }
    return null;
  }

  async getSpreadsheet(spreadsheetId: string): Promise<sheets_v4.Schema$Spreadsheet> {
    const sheets = await this.getClient();
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    return res.data;
  }

  /** Returns the gid (sheetId) for a tab name, or null if missing. */
  async getSheetId(spreadsheetId: string, sheetName: string): Promise<number | null> {
    const meta = await this.getSpreadsheet(spreadsheetId);
    const tab = (meta.sheets ?? []).find((s) => s.properties?.title === sheetName);
    return tab?.properties?.sheetId ?? null;
  }

  /**
   * Ensures a tab exists with the given headers. If the tab is missing it is
   * created and headers are written. If the tab exists with no header row,
   * headers are written. If headers already exist, they are not overwritten.
   */
  async ensureSheet(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void> {
    const sheets = await this.getClient();
    const existingId = await this.getSheetId(spreadsheetId, sheetName);

    if (existingId === null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                  gridProperties: { frozenRowCount: 1 },
                },
              },
            },
          ],
        },
      });
    }

    const headerRange = `${sheetName}!1:1`;
    const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: headerRange });
    const existingHeaders = existing.data.values?.[0] ?? [];

    if (existingHeaders.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      });
    }
  }

  /** Returns all values from a single column (excluding the header row). */
  async getColumnValues(
    spreadsheetId: string,
    sheetName: string,
    column: string = 'A'
  ): Promise<string[]> {
    const sheets = await this.getClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${column}2:${column}`,
    });
    return (res.data.values ?? []).map((r) => (r[0] ?? '').toString());
  }

  /** Appends rows to the bottom of the sheet. */
  async appendRows(
    spreadsheetId: string,
    sheetName: string,
    rows: (string | number | boolean | null)[][]
  ): Promise<void> {
    if (rows.length === 0) return;
    const sheets = await this.getClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : v))) },
    });
  }

  /**
   * Upserts a batch of rows keyed on the value in `keyColumnIndex` (0-indexed).
   * Reads existing key values once, partitions input rows into updates vs.
   * appends, then performs a single batch update + a single append.
   */
  async upsertRows(
    spreadsheetId: string,
    sheetName: string,
    keyColumnIndex: number,
    rows: (string | number | boolean | null)[][]
  ): Promise<{ updated: number; appended: number }> {
    if (rows.length === 0) return { updated: 0, appended: 0 };
    const sheets = await this.getClient();

    const keyColumnLetter = columnIndexToLetter(keyColumnIndex);
    const existingKeys = await this.getColumnValues(spreadsheetId, sheetName, keyColumnLetter);
    const keyToRowNumber = new Map<string, number>();
    existingKeys.forEach((k, i) => {
      if (k !== '' && !keyToRowNumber.has(k)) keyToRowNumber.set(k, i + 2); // +2: 1-indexed + header
    });

    const updates: { range: string; values: any[][] }[] = [];
    const appends: any[][] = [];

    for (const row of rows) {
      const key = row[keyColumnIndex];
      if (key === null || key === undefined || key === '') {
        appends.push(row);
        continue;
      }
      const existingRowNumber = keyToRowNumber.get(key.toString());
      const safeRow = row.map((v) => (v === null || v === undefined ? '' : v));
      if (existingRowNumber !== undefined) {
        const lastCol = columnIndexToLetter(row.length - 1);
        updates.push({
          range: `${sheetName}!A${existingRowNumber}:${lastCol}${existingRowNumber}`,
          values: [safeRow],
        });
      } else {
        appends.push(safeRow);
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }
    if (appends.length > 0) {
      await this.appendRows(spreadsheetId, sheetName, appends);
    }

    return { updated: updates.length, appended: appends.length };
  }

  getSheetUrl(spreadsheetId: string, sheetGid?: number | null): string {
    const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    return sheetGid != null ? `${base}/edit#gid=${sheetGid}` : `${base}/edit`;
  }
}

function columnIndexToLetter(index: number): string {
  let n = index;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
