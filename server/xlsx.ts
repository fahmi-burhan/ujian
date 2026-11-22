// server/xlsx.ts — pembuat berkas Excel (.xlsx) minimal tanpa pustaka tambahan: satu lembar, baris judul tebal &
// dibekukan, lebar kolom, sel teks dan sel angka (format 1 desimal).
// Dipanggil oleh: server/routes/penilaian.ts (unduh nilai .xlsx).
// Memanggil: node:zlib (deflateRawSync, crc32 bawaan Node 24).
// Alasan (keputusan pemilik 22 Nov): CSV selalu bergantung pengaturan wilayah Windows (en-US memakai ',' dan '.',
// Indonesia memakai ';' dan ','), sehingga tidak bisa rapi di semua laptop. .xlsx menyimpan angka sebagai angka
// dan Excel menampilkannya sesuai pengaturan masing-masing.
// Keamanan: semua teks ditulis sebagai "inline string" (bukan rumus), jadi nama/judul yang diawali "=" tidak
// pernah dijalankan Excel (setara pengaman CSV injection di aturan keras #10). Karakter yang tidak sah di XML dibuang.
// Format berkas: ECMA-376 (Office Open XML), paket zip berisi beberapa berkas XML.
import { crc32, deflateRawSync } from 'node:zlib';

export type Sel = string | number | null;
export type Lembar = { nama: string; kolom: { judul: string; lebar: number }[]; baris: Sel[][] };

// Karakter kendali selain tab/baris baru tidak sah di XML 1.0.
function bersihkan(teks: string): string {
  return teks.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
}

function xml(teks: string): string {
  return bersihkan(teks).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 0 → A, 25 → Z, 26 → AA.
export function hurufKolom(i: number): string {
  let n = i + 1;
  let hasil = '';
  while (n > 0) {
    const sisa = (n - 1) % 26;
    hasil = String.fromCharCode(65 + sisa) + hasil;
    n = Math.floor((n - 1) / 26);
  }
  return hasil;
}

// Gaya: 0 = biasa, 1 = tebal (judul kolom), 2 = angka 1 desimal.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sel(ref: string, nilai: Sel, gaya: number): string {
  if (nilai === null || nilai === '') return '';
  if (typeof nilai === 'number' && Number.isFinite(nilai)) return `<c r="${ref}" s="${gaya === 1 ? 1 : 2}"><v>${nilai}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${gaya === 1 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(String(nilai))}</t></is></c>`;
}

function lembarXml(l: Lembar): string {
  const kolom = l.kolom.map((k, i) => `<col min="${i + 1}" max="${i + 1}" width="${k.lebar}" customWidth="1"/>`).join('');
  const judul = `<row r="1">${l.kolom.map((k, i) => sel(`${hurufKolom(i)}1`, k.judul, 1)).join('')}</row>`;
  const isi = l.baris
    .map((b, r) => `<row r="${r + 2}">${b.map((v, i) => sel(`${hurufKolom(i)}${r + 2}`, v, 0)).join('')}</row>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${kolom}</cols>
<sheetData>${judul}${isi}</sheetData>
</worksheet>`;
}

// Nama lembar Excel: maks 31 karakter, tanpa : \ / ? * [ ].
function namaLembar(nama: string): string {
  return bersihkan(nama).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Lembar1';
}

// ---- Zip (metode deflate) ----
type Entri = { nama: string; isi: Buffer };

function zip(entri: Entri[]): Buffer {
  const lokal: Buffer[] = [];
  const pusat: Buffer[] = [];
  let offset = 0;
  // Tanggal tetap 1 Jan 2026 00:00 (format DOS); isi berkas tidak bergantung jam.
  const tanggalDos = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const e of entri) {
    const nama = Buffer.from(e.nama, 'utf8');
    const padat = deflateRawSync(e.isi);
    const crc = crc32(e.isi) >>> 0;
    const kepala = Buffer.alloc(30);
    kepala.writeUInt32LE(0x04034b50, 0);
    kepala.writeUInt16LE(20, 4); // versi yang dibutuhkan
    kepala.writeUInt16LE(0x0800, 6); // nama berkas UTF-8
    kepala.writeUInt16LE(8, 8); // deflate
    kepala.writeUInt16LE(0, 10); // jam
    kepala.writeUInt16LE(tanggalDos, 12);
    kepala.writeUInt32LE(crc, 14);
    kepala.writeUInt32LE(padat.length, 18);
    kepala.writeUInt32LE(e.isi.length, 22);
    kepala.writeUInt16LE(nama.length, 26);
    kepala.writeUInt16LE(0, 28);
    lokal.push(kepala, nama, padat);

    const p = Buffer.alloc(46);
    p.writeUInt32LE(0x02014b50, 0);
    p.writeUInt16LE(20, 4);
    p.writeUInt16LE(20, 6);
    p.writeUInt16LE(0x0800, 8);
    p.writeUInt16LE(8, 10);
    p.writeUInt16LE(0, 12);
    p.writeUInt16LE(tanggalDos, 14);
    p.writeUInt32LE(crc, 16);
    p.writeUInt32LE(padat.length, 20);
    p.writeUInt32LE(e.isi.length, 24);
    p.writeUInt16LE(nama.length, 28);
    p.writeUInt32LE(offset, 42);
    pusat.push(p, nama);
    offset += kepala.length + nama.length + padat.length;
  }
  const ukuranPusat = pusat.reduce((n, b) => n + b.length, 0);
  const akhir = Buffer.alloc(22);
  akhir.writeUInt32LE(0x06054b50, 0);
  akhir.writeUInt16LE(entri.length, 8);
  akhir.writeUInt16LE(entri.length, 10);
  akhir.writeUInt32LE(ukuranPusat, 12);
  akhir.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, ...pusat, akhir]);
}

export function buatXlsx(l: Lembar): Buffer {
  const nama = xml(namaLembar(l.nama));
  const berkas: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${nama}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', lembarXml(l)],
  ];
  return zip(berkas.map(([n, isi]) => ({ nama: n, isi: Buffer.from(isi, 'utf8') })));
}
