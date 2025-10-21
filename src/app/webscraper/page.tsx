'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,   // <-- pakai type ReactNode
} from 'react';

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

type PreviewResp = { rows: Record<string, any>[]; total?: number };

// ===== Card helper (DI LUAR return, aman) =====
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

export default function WebscraperPage() {
  // ===== FORM STATE
  const envBase = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  const [baseUrl, setBaseUrl] = useState(envBase);
  const [kabkota] = useState('Kabupaten Semarang'); // dikunci
  const [kecamatanText, setKecamatanText] = useState('');
  const [query, setQuery] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [mode, setMode] = useState<'grid' | 'centroid'>('grid');
  const [gridSize, setGridSize] = useState(800);
  const [sheetPerKec, setSheetPerKec] = useState(true);
  const [freezeHeader, setFreezeHeader] = useState(true);

  // ===== JOB
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);

  const kecList = useMemo(
    () => kecamatanText.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    [kecamatanText]
  );
  const pct = Math.round(
    Math.max(0, Math.min(100, status?.overallProgress ?? status?.progress ?? 0))
  );

  // ===== POLLING
  const stopPolling = () => { if (poller.current) { clearInterval(poller.current); poller.current = null; } };
  useEffect(() => stopPolling, []);

  const startPolling = (base: string, job: string) => {
    stopPolling();
    poller.current = setInterval(async () => {
      try {
        const r = await fetch(`${base}/api/jobs/${job}/status`);
        if (!r.ok) throw new Error('Gagal mengambil status');
        const s: JobStatus = await r.json();
        setStatus(s);
        if (s.status === 'done') {
          stopPolling();
          try {
            const p = await fetch(`${base}/api/jobs/${job}/preview?limit=50`);
            if (p.ok) setPreview(await p.json());
          } catch {}
        }
        if (s.status === 'error') {
          stopPolling();
          setError(s.message || 'Terjadi kesalahan pada proses backend.');
        }
      } catch (e: any) {
        stopPolling();
        setError(e.message ?? String(e));
      }
    }, 1400);
  };

  // ===== ACTIONS
  const handleStart = async () => {
    setError(''); setPreview(null);
    setStatus({ status: 'queued', phase: 'Membuat job…' });

    if (!baseUrl || !kabkota || kecList.length === 0) {
      setError('Isi Server URL, Kab/Kota, dan minimal satu kecamatan.');
      setStatus(null); return;
    }

    const payload = {
      kabkota,
      kecamatan: kecList,
      query: query || null,
      types: ['primary_school', 'school'], // fokus SD
      filters: { minRating, openNow: null, limitPerKecamatan: null },
      strategy: { mode, gridSizeMeters: gridSize, gridOverlapMeters: 150, dedupeMeters: 40 },
      columns: ['name','formatted_address','phone','email','website','male_students'], // 6 kolom final
      excel: { sheetPerKecamatan: sheetPerKec, withMetadataSheet: true, autoFit: true, freezeHeader }
    };

    try {
      const r = await fetch(`${baseUrl}/api/gmaps/kecamatan/scrape`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error('Gagal memulai job. Cek endpoint & CORS.');
      const data = await r.json();
      if (!data.jobId) throw new Error('Respons tidak mengandung jobId');
      setJobId(String(data.jobId));
      startPolling(baseUrl, String(data.jobId));
    } catch (e: any) { setStatus(null); setError(e.message ?? String(e)); }
  };

  const handleDownload = () => {
    if (jobId) window.location.href = `${baseUrl}/api/jobs/${jobId}/download?format=xlsx`;
  };

  // ===== UI
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 text-slate-800">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Hero */}
        <div className="mb-6 rounded-3xl bg-white/70 p-6 shadow-xl ring-1 ring-slate-200 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">Sekolah Dasar · Per Kecamatan</div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight">Scraper SD (Kab. Semarang) → Excel</h1>
              <p className="mt-1 text-sm text-slate-500">Output: <b>nama sekolah</b>, <b>alamat</b>, <b>telepon/WA</b>, <b>email</b>, <b>website</b>, <b>peserta didik laki-laki</b></p>
            </div>
            <span className="h-8 shrink-0 rounded-full bg-slate-100 px-3 text-xs leading-8 text-slate-700 ring-1 ring-slate-200">Frontend only</span>
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
                onChange={e=>setBaseUrl(e.target.value)}
                placeholder="http://localhost:8000"
              />
              <p className="mt-1 text-xs text-slate-500">Aktifkan CORS jika domain/port berbeda.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Excel options</label>
              <div className="flex flex-wrap gap-2 text-xs">
                <label className="inline-flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-indigo-700 ring-1 ring-indigo-200">
                  <input type="checkbox" checked={sheetPerKec} onChange={e=>setSheetPerKec(e.target.checked)} />
                  Sheet per kecamatan
                </label>
                <label className="inline-flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-indigo-700 ring-1 ring-indigo-200">
                  <input type="checkbox" checked={freezeHeader} onChange={e=>setFreezeHeader(e.target.checked)} />
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
              <input className="w-full cursor-not-allowed rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm shadow-inner" value={kabkota} readOnly />
              <p className="mt-1 text-xs text-slate-500">Dikunci ke Kabupaten Semarang.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Daftar Kecamatan (satu per baris)</label>
              <textarea
                className="min-h-[140px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                placeholder="Tempelkan daftar kecamatan di sini"
                value={kecamatanText}
                onChange={e=>setKecamatanText(e.target.value)}
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
                onChange={e=>setQuery(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">Kategori otomatis: <b>primary_school</b> (+ school).</p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Min Rating (opsional)</label>
              <input
                type="number" min={0} max={5} step={0.1}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                value={minRating}
                onChange={e=>setMinRating(Number(e.target.value || 0))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Strategi</label>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                value={mode}
                onChange={e=>setMode(e.target.value as 'grid'|'centroid')}
              >
                <option value="grid">Grid tiling</option>
                <option value="centroid">Centroid + radius</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Ukuran grid (m) / Radius (m)</label>
              <input
                type="number" min={200} step={100}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                value={gridSize}
                onChange={e=>setGridSize(Number(e.target.value || 800))}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleStart}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:-translate-y-0.5 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600/40"
            >
              Mulai
            </button>
            <p className="text-xs text-slate-500">Setelah selesai, tombol <b>Unduh Excel</b> akan aktif.</p>
          </div>
        </Card>

        {/* 4) Status */}
        {status && (
          <Card title="4) Status Proses">
            <div className="flex items-end justify-between">
              <div className="text-xs text-slate-700">
                <div className="font-medium">{status.phase ?? status.status}</div>
                <div className="text-slate-500">
                  {status.currentKecamatanName && <>Kec. saat ini: {status.currentKecamatanName} · </>}
                  {status.currentKecamatanIndex!=null && status.totalKecamatan!=null && <>Kecamatan: {status.currentKecamatanIndex+1}/{status.totalKecamatan} · </>}
                  {status.found!=null && <>Ditemukan total: {status.found}</>}
                </div>
              </div>
              <div className="text-xs">Overall: <b>{pct}%</b></div>
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
                disabled={status.status!=='done'}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200 transition hover:bg-white disabled:opacity-60"
              >
                Unduh Excel
              </button>
            </div>

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </Card>
        )}

        {/* 5) Preview */}
        {preview && (
          <Card title="5) Preview Data">
            <p className="text-xs text-slate-500">
              Menampilkan {preview.rows.length}{preview.total ? ` dari ${preview.total}` : ''} baris
            </p>
            <div className="mt-2 overflow-auto rounded-2xl ring-1 ring-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left">
                    {['name','formatted_address','phone','email','website','male_students'].map(k => (
                      <th key={k} className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-700">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="odd:bg-white even:bg-slate-50">
                      {['name','formatted_address','phone','email','website','male_students'].map(k => (
                        <td key={k} className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-slate-700">{String(row?.[k] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Preview hanya sebagian baris. Excel berisi data lengkap.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
