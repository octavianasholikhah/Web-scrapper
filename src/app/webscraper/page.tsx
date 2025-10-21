'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ================== TYPES ==================
type JobStatus = {
  status: 'queued' | 'running' | 'done' | 'error';
  phase?: string;
  overallProgress?: number;
  progress?: number;
  currentKecamatanName?: string;
  currentKecamatanIndex?: number;
  totalKecamatan?: number;
  found?: number;
  message?: string;
};

type PreviewResp = {
  rows: Array<Record<string, unknown>>;
  total?: number;
};

type CreateJobResp = {
  jobId?: string;
};

// ================== UI HELPERS ==================
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-3xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
      <div className="mb-3 border-b pb-2">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      {children}
    </section>
  );
}

// ================== COLUMN DEFINITIONS ==================
type ColDef = {
  value: string;
  label: string;
  group: string;
  default?: boolean;
  hint?: string;
};

const ALL_COLUMNS: ColDef[] = [
  // Identitas
  { value: 'name', label: 'nama', group: 'Identitas', default: true },
  { value: 'place_id', label: 'place_id', group: 'Identitas' },

  // Alamat
  { value: 'formatted_address', label: 'alamat', group: 'Alamat', default: true },
  { value: 'kelurahan', label: 'kelurahan', group: 'Alamat' },
  { value: 'kecamatan', label: 'kecamatan', group: 'Alamat' },
  { value: 'kabkota', label: 'kab/kota', group: 'Alamat' },
  { value: 'provinsi', label: 'provinsi', group: 'Alamat' },
  { value: 'kode_pos', label: 'kode_pos', group: 'Alamat' },

  // Kontak
  { value: 'phone', label: 'telepon/WA', group: 'Kontak', default: true, hint: 'Google; WA bisa dibentuk di backend' },
  { value: 'email', label: 'email', group: 'Kontak', default: true },
  { value: 'website', label: 'website', group: 'Kontak', default: true },

  // Koordinat
  { value: 'latitude', label: 'latitude', group: 'Koordinat' },
  { value: 'longitude', label: 'longitude', group: 'Koordinat' },

  // Metadata Google
  { value: 'google_maps_url', label: 'google_maps_url', group: 'Maps Meta' },
  { value: 'rating', label: 'rating', group: 'Maps Meta' },
  { value: 'user_ratings_total', label: 'user_ratings_total', group: 'Maps Meta' },
  { value: 'types', label: 'types', group: 'Maps Meta' },
  { value: 'open_now', label: 'open_now', group: 'Maps Meta' },
  { value: 'business_status', label: 'business_status', group: 'Maps Meta' },

  // Enrichment (butuh sumber non-Maps)
  { value: 'male_students', label: 'peserta didik laki-laki', group: 'Enrichment', default: true, hint: 'perlu Dapodik/Referensi' },
  { value: 'female_students', label: 'peserta didik perempuan', group: 'Enrichment' },
  { value: 'total_students', label: 'total peserta didik', group: 'Enrichment' },
  { value: 'npsn', label: 'npsn', group: 'Enrichment' },
  { value: 'status_sekolah', label: 'status_sekolah', group: 'Enrichment' },
  { value: 'jenjang', label: 'jenjang', group: 'Enrichment' },
  { value: 'kepala_sekolah', label: 'kepala_sekolah', group: 'Enrichment' },
];

const DEFAULT_COLS = ALL_COLUMNS.filter(c => c.default).map(c => c.value);

// ================== PAGE ==================
export default function WebscraperPage() {
  // ---- FORM STATE
  const envBase = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  const [baseUrl, setBaseUrl] = useState(envBase);
  const [kabkota] = useState('Kabupaten Semarang'); // terkunci
  const [kecamatanText, setKecamatanText] = useState('');
  const [query, setQuery] = useState('');
  const [minRating, setMinRating] = useState<number>(0);
  const [mode, setMode] = useState<'grid' | 'centroid'>('grid');
  const [gridSize, setGridSize] = useState<number>(800);

  // Excel prefs
  const [sheetPerKec, setSheetPerKec] = useState(true);
  const [freezeHeader, setFreezeHeader] = useState(true);

  // Pilihan kolom
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);

  // ---- JOB STATE
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string>('');
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);

  const kecList = useMemo(
    () =>
      kecamatanText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [kecamatanText]
  );

  const pct = Math.round(
    Math.max(0, Math.min(100, status?.overallProgress ?? status?.progress ?? 0))
  );

  // ---- GROUPED COLUMNS
  const grouped = useMemo(() => {
    const g = new Map<string, ColDef[]>();
    for (const c of ALL_COLUMNS) {
      if (!g.has(c.group)) g.set(c.group, []);
      g.get(c.group)!.push(c);
    }
    return g;
  }, []);

  const toggleCol = (v: string) =>
    setCols((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  const selectAll = () => setCols(ALL_COLUMNS.map((c) => c.value));
  const selectNone = () => setCols([]);
  const presetMinimal = () => setCols(DEFAULT_COLS);
  const presetPlacesBasic = () =>
    setCols([
      'name',
      'formatted_address',
      'phone',
      'website',
      'rating',
      'user_ratings_total',
      'google_maps_url',
      'latitude',
      'longitude',
      'types',
    ]);

  // ---- POLLING HELPERS
  const stopPolling = () => {
    if (poller.current) {
      clearInterval(poller.current);
      poller.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const startPolling = (base: string, job: string) => {
    stopPolling();
    poller.current = setInterval(async () => {
      try {
        const r = await fetch(`${base}/api/jobs/${job}/status`);
        if (!r.ok) throw new Error('Gagal mengambil status');
        const s = (await r.json()) as JobStatus;
        setStatus(s);

        if (s.status === 'done') {
          stopPolling();
          try {
            const p = await fetch(`${base}/api/jobs/${job}/preview?limit=50`);
            if (p.ok) {
              const body = (await p.json()) as PreviewResp;
              setPreview(body);
            }
          } catch {
            // abaikan preview error
          }
        }
        if (s.status === 'error') {
          stopPolling();
          setError(s.message ?? 'Terjadi kesalahan pada proses backend.');
        }
      } catch (e: unknown) {
        stopPolling();
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    }, 1400);
  };

  // ---- ACTIONS
  const handleStart = async () => {
    setError('');
    setPreview(null);
    setStatus({ status: 'queued', phase: 'Membuat job…' });

    if (!baseUrl || kecList.length === 0) {
      setError('Isi Server URL dan minimal satu kecamatan.');
      setStatus(null);
      return;
    }
    if (cols.length === 0) {
      setError('Pilih minimal satu kolom output.');
      setStatus(null);
      return;
    }

    const payload = {
      kabkota,
      kecamatan: kecList,
      query: query || null,
      types: ['primary_school', 'school'], // fokus SD
      filters: { minRating, openNow: null as null | boolean, limitPerKecamatan: null as null | number },
      strategy: {
        mode,
        gridSizeMeters: gridSize,
        gridOverlapMeters: 150,
        dedupeMeters: 40,
      },
      columns: cols, // dinamis sesuai pilihan
      excel: {
        sheetPerKecamatan: sheetPerKec,
        withMetadataSheet: true,
        autoFit: true,
        freezeHeader,
      },
    };

    try {
      const r = await fetch(`${baseUrl}/api/gmaps/kecamatan/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('Gagal memulai job. Cek endpoint & CORS.');
      const data = (await r.json()) as CreateJobResp;
      if (!data.jobId) throw new Error('Respons tidak mengandung jobId');
      setJobId(String(data.jobId));
      startPolling(baseUrl, String(data.jobId));
    } catch (e: unknown) {
      setStatus(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  };

  const handleDownload = () => {
    if (jobId) {
      window.location.href = `${baseUrl}/api/jobs/${jobId}/download?format=xlsx`;
    }
  };

  // ================== RENDER ==================
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 text-slate-800">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Hero */}
        <div className="mb-6 rounded-3xl bg-white/70 p-6 shadow-xl ring-1 ring-slate-200 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                Sekolah Dasar · Per Kecamatan
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight">
                Scraper SD (Kab. Semarang) → Excel
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Pilih output: <b>nama, alamat, kontak, koordinat, meta Google</b> + kolom{' '}
                <b>enrichment</b> (opsional).
              </p>
            </div>
            <span className="h-8 shrink-0 rounded-full bg-slate-100 px-3 text-xs leading-8 text-slate-700 ring-1 ring-slate-200">
              Frontend only
            </span>
          </div>
        </div>

        {/* 1) Koneksi */}
        <Card title="1) Koneksi ke Server Backend">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-600">Server URL backend</label>
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:8000"
              />
              <p className="mt-1 text-xs text-slate-500">Aktifkan CORS jika domain/port berbeda.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Excel options</label>
              <div className="flex flex-wrap gap-2 text-xs">
                <label className="inline-flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-indigo-700 ring-1 ring-indigo-200">
                  <input
                    type="checkbox"
                    checked={sheetPerKec}
                    onChange={(e) => setSheetPerKec(e.target.checked)}
                  />
                  Sheet per kecamatan
                </label>
                <label className="inline-flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-indigo-700 ring-1 ring-indigo-200">
                  <input
                    type="checkbox"
                    checked={freezeHeader}
                    onChange={(e) => setFreezeHeader(e.target.checked)}
                  />
                  Freeze header + Autofilter
                </label>
              </div>
            </div>
          </div>
        </Card>

        {/* 2) Target Wilayah */}
        <Card title="2) Target Wilayah (Kab. Semarang)">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-600">Kabupaten</label>
              <input
                className="w-full cursor-not-allowed rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm shadow-inner"
                value={kabkota}
                readOnly
              />
              <p className="mt-1 text-xs text-slate-500">Dikunci ke Kabupaten Semarang.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Daftar Kecamatan (satu per baris)</label>
              <textarea
                className="min-h-[140px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                placeholder="Tempelkan daftar kecamatan di sini"
                value={kecamatanText}
                onChange={(e) => setKecamatanText(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* 3) Parameter */}
        <Card title="3) Parameter Pencarian">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-600">Kata kunci (opsional)</label>
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                placeholder="mis. SD, SD Negeri, Al Azhar"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                Kategori otomatis: <b>primary_school</b> (+ school).
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Min Rating (opsional)</label>
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value || 0))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Strategi</label>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'grid' | 'centroid')}
              >
                <option value="grid">Grid tiling</option>
                <option value="centroid">Centroid + radius</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Ukuran grid (m) / Radius (m)</label>
              <input
                type="number"
                min={200}
                step={100}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value || 800))}
              />
            </div>
          </div>
        </Card>

        {/* 4) Pilih Kolom Output */}
        <Card title="4) Pilih Kolom Output">
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <button
              onClick={presetMinimal}
              className="rounded-full bg-slate-100 px-3 py-1 ring-1 ring-slate-200 hover:bg-white"
            >
              Preset: Minimal (6 kolom)
            </button>
            <button
              onClick={presetPlacesBasic}
              className="rounded-full bg-slate-100 px-3 py-1 ring-1 ring-slate-200 hover:bg-white"
            >
              Preset: Places Basic
            </button>
            <button
              onClick={selectAll}
              className="rounded-full bg-slate-100 px-3 py-1 ring-1 ring-slate-200 hover:bg-white"
            >
              Pilih semua
            </button>
            <button
              onClick={selectNone}
              className="rounded-full bg-slate-100 px-3 py-1 ring-1 ring-slate-200 hover:bg-white"
            >
              Kosongkan
            </button>
          </div>

          {[...grouped.keys()].map((group) => (
            <div key={group} className="mb-3">
              <div className="mb-2 text-xs font-semibold text-slate-600">{group}</div>
              <div className="flex flex-wrap gap-2">
                {grouped.get(group)!.map((col) => (
                  <label
                    key={col.value}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-slate-700 ring-1 ring-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={cols.includes(col.value)}
                      onChange={() => toggleCol(col.value)}
                    />
                    <span className="text-xs">{col.label}</span>
                    {col.hint && <span className="text-[10px] text-slate-400">({col.hint})</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleStart}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:-translate-y-0.5 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600/40"
            >
              Mulai
            </button>
            <p className="text-xs text-slate-500">
              Frontend akan mengirim <b>{cols.length}</b> kolom terpilih ke backend → Excel.
            </p>
          </div>
        </Card>

        {/* 5) Status */}
        {status && (
          <Card title="5) Status Proses">
            <div className="flex items-end justify-between">
              <div className="text-xs text-slate-700">
                <div className="font-medium">{status.phase ?? status.status}</div>
                <div className="text-slate-500">
                  {status.currentKecamatanName && <>Kec. saat ini: {status.currentKecamatanName} · </>}
                  {status.currentKecamatanIndex != null &&
                    status.totalKecamatan != null && (
                      <>Kecamatan: {status.currentKecamatanIndex + 1}/{status.totalKecamatan} · </>
                    )}
                  {status.found != null && <>Ditemukan total: {status.found}</>}
                </div>
              </div>
              <div className="text-xs">
                Overall: <b>{pct}%</b>
              </div>
            </div>

            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-3 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,.35)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.35)_50%,rgba(255,255,255,.35)_75%,transparent_75%,transparent)] bg-[length:16px_16px] bg-blue-600 transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={handleDownload}
                disabled={status.status !== 'done'}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200 transition hover:bg-white disabled:opacity-60"
              >
                Unduh Excel
              </button>
            </div>

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </Card>
        )}

        {/* 6) Preview */}
        {preview && (
          <Card title="6) Preview Data">
            <p className="text-xs text-slate-500">
              Menampilkan {preview.rows.length}
              {preview.total ? ` dari ${preview.total}` : ''} baris
            </p>
            <div className="mt-2 overflow-auto rounded-2xl ring-1 ring-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left">
                    {cols.map((k) => (
                      <th
                        key={k}
                        className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-700"
                      >
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="odd:bg-white even:bg-slate-50">
                      {cols.map((k) => (
                        <td
                          key={k}
                          className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-slate-700"
                        >
                          {String((row as Record<string, unknown>)[k] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Preview mengikuti kolom yang dipilih. Excel berisi data lengkap.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
