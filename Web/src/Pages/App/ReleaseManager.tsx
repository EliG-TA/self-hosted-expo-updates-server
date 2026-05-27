import { useEffect, useState } from 'react'
import moment from 'moment'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { TabPanel, TabView } from 'primereact/tabview'

import { Button, Card, Colors, ConfirmDialog, Flex, Spinner, StatusPill, Text } from '../../Components'
import { FC, invalidateQuery, useCQuery } from '../../Services'
import type { AppRecord, IntegrityIssue, ListResult, ServiceOutcome, UnknownRecord, UploadRecord } from '../../types'
import { listFromResult } from '../../types'
import { Release } from './Release'
import { UpdateInstructions } from './UpdateInstructions'

const fmtBytes = (n?: number) => {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const CATEGORY_LABELS = {
  zip: 'Zip',
  dir: 'Directory',
  metadata: 'metadata.json',
  'app-json': 'app.json',
  'package-json': 'package.json',
  bundle: 'Bundle',
  asset: 'Asset',
  hash: 'Hash drift',
  db: 'DB fields',
}

interface IntegrityProblem extends UploadRecord {
  issues: Array<IntegrityIssue & { category?: string }>
}

interface IntegrityResult extends UnknownRecord {
  checkedCount?: number
  errorRowCount?: number
  warningRowCount?: number
  problemCount: number
  problems: IntegrityProblem[]
}

interface CleanupResult extends ServiceOutcome {
  count?: number
  computedForDays: number
  totalBytes?: number
  candidates?: UploadRecord[]
  zipsRemoved?: number
  zipsMissing?: number
  dirsRemoved?: number
  dirsMissing?: number
  errors?: unknown[]
}

const isCleanupResult = (value: unknown): value is Omit<CleanupResult, 'computedForDays'> =>
  value !== null && typeof value === 'object'

const categoryLabel = (cat: string) => CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat

const FilterChip = ({
  label,
  active,
  onClick,
  color,
}: {
  label: string
  active: boolean
  onClick: () => void
  color: string
}) => (
  <span
    onClick={onClick}
    style={{
      padding: '4px 10px',
      borderRadius: 14,
      cursor: 'pointer',
      fontSize: 11,
      fontWeight: 600,
      userSelect: 'none',
      backgroundColor: active ? color : 'rgba(255,255,255,0.06)',
      color: active ? '#fff' : 'rgba(255,255,255,0.55)',
      border: `1px solid ${active ? color : 'rgba(255,255,255,0.12)'}`,
    }}>
    {label}
  </span>
)

const IntegrityCheckSection = ({
  project,
  onOpenUpload,
}: {
  project: string
  onOpenUpload?: (upload: UploadRecord) => void
}) => {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<IntegrityResult | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(true)
  const [showWarnings, setShowWarnings] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set()) // empty = show all

  const handleCheck = async () => {
    setChecking(true)
    setResult(null)
    try {
      const res = (await FC.client.service('utils').update('checkIntegrity', { project })) as IntegrityResult
      setResult(res)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Integrity check failed', detail: e.message })
    }
    setChecking(false)
  }

  const toggleCategory = (cat: string) => {
    const next = new Set(categoryFilter)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    setCategoryFilter(next)
  }

  // Categories actually present in the current result — drives which
  // category chips render at all (no point offering 'hash' if no upload
  // has a hash drift right now).
  const presentCategories = new Set<string>()
  for (const p of result?.problems || []) {
    for (const iss of p.issues) iss.category && presentCategories.add(iss.category)
  }

  // Filters select which upload rows to show — an upload is included if at
  // least one of its issues passes the active severity+category filter.
  // The Issues column itself always renders every issue of the upload, so
  // the user sees the full context (and can decide to widen the filter to
  // inspect related but currently-filtered-out problems).
  const rowMatches = (p: IntegrityProblem) =>
    p.issues.some((iss) => {
      if (iss.severity === 'error' && !showErrors) return false
      if (iss.severity === 'warning' && !showWarnings) return false
      if (categoryFilter.size > 0 && !categoryFilter.has(iss.category)) return false
      return true
    })
  const filteredProblems = (result?.problems || []).filter(rowMatches)

  const handleOpen = async (row: UploadRecord) => {
    if (!row?._id) return
    setOpening(row._id)
    try {
      const upload = (await FC.client.service('uploads').get(row._id)) as UploadRecord
      onOpenUpload?.(upload)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Failed to load upload', detail: e.message })
    }
    setOpening(null)
  }

  return (
    <div style={{ width: '100%' }}>
      <Flex fw as style={{ gap: 12, padding: 10 }}>
        <Text
          value="Walk every upload and check that its zip archive, extracted directory, metadata.json, per-platform launch bundle, and individual asset files exist on disk. Useful after a restore-from-backup or manual file operations."
          size={12}
          color="rgba(255,255,255,0.6)"
        />

        <Flex row style={{ gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          {result && (
            <>
              <Flex as>
                <Text value="Checked" size={11} color="rgba(255,255,255,0.5)" />
                <Text value={String(result.checkedCount)} bold size={20} />
              </Flex>
              <Flex as>
                <Text value="With errors" size={11} color="rgba(255,255,255,0.5)" />
                <Text
                  value={String(result.errorRowCount || 0)}
                  bold
                  size={20}
                  color={result.errorRowCount > 0 ? '#ef5350' : undefined}
                />
              </Flex>
              <Flex as>
                <Text value="Warnings only" size={11} color="rgba(255,255,255,0.5)" />
                <Text
                  value={String(result.warningRowCount || 0)}
                  bold
                  size={20}
                  color={result.warningRowCount > 0 ? '#ffb300' : undefined}
                />
              </Flex>
            </>
          )}
        </Flex>

        <Flex row style={{ marginTop: 10 }}>
          {checking ? (
            <Spinner />
          ) : (
            <Button icon="check-square" label={result ? 'Re-run check' : 'Run integrity check'} onClick={handleCheck} />
          )}
        </Flex>

        {result && result.problemCount > 0 && (
          <div style={{ width: '100%', marginTop: 16 }}>
            <Flex row style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <Text value="Show:" size={11} color="rgba(255,255,255,0.5)" style={{ marginRight: 2 }} />
              <FilterChip label="Errors" active={showErrors} color="#ef5350" onClick={() => setShowErrors((v) => !v)} />
              <FilterChip
                label="Warnings"
                active={showWarnings}
                color="#ffb300"
                onClick={() => setShowWarnings((v) => !v)}
              />
              <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
              <Text value="Category:" size={11} color="rgba(255,255,255,0.5)" style={{ marginRight: 2 }} />
              {[...presentCategories].sort().map((cat) => (
                <FilterChip
                  key={cat}
                  label={categoryLabel(cat)}
                  active={categoryFilter.has(cat)}
                  color={Colors.primary}
                  onClick={() => toggleCategory(cat)}
                />
              ))}
              {categoryFilter.size > 0 && (
                <FilterChip
                  label="clear all"
                  active={false}
                  color="rgba(255,255,255,0.2)"
                  onClick={() => setCategoryFilter(new Set())}
                />
              )}
              <span style={{ flex: 1 }} />
              <Text
                value={`${filteredProblems.length} / ${result.problemCount} rows`}
                size={11}
                color="rgba(255,255,255,0.5)"
              />
            </Flex>
            <DataTable
              value={filteredProblems}
              size="small"
              paginator={result.problems.length > 10}
              rows={10}
              sortField="createdAt"
              sortOrder={-1}
              style={{ width: '100%' }}>
              <Column
                field="updateId"
                header="Update ID"
                sortable
                filter
                body={(row) => (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpen(row)
                    }}
                    title={opening === row._id ? 'Loading…' : 'Open update details'}
                    style={{
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 12,
                      wordBreak: 'break-all',
                      cursor: 'pointer',
                      color: Colors.primary,
                      textDecoration: 'underline dotted',
                      opacity: opening === row._id ? 0.5 : 1,
                    }}>
                    {row.updateId || '—'}
                  </span>
                )}
              />
              <Column
                field="createdAt"
                header="Created"
                sortable
                style={{ width: 170 }}
                body={(row) => (
                  <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {row.createdAt ? moment(row.createdAt).format('YYYY-MM-DD HH:mm:ss') : '—'}
                  </span>
                )}
              />
              <Column field="version" header="Version" sortable filter style={{ width: 100 }} />
              <Column field="releaseChannel" header="Channel" sortable filter style={{ width: 130 }} />
              <Column
                field="status"
                header="Status"
                sortable
                filter
                style={{ width: 110 }}
                body={({ status }) => <StatusPill status={status} />}
              />
              <Column
                field="issues"
                header="Issues"
                body={(row) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {row.issues.map((iss, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 12,
                          color: iss.severity === 'warning' ? '#ffd54f' : '#ef9a9a',
                        }}>
                        {iss.severity === 'warning' ? '⚠ ' : '• '}
                        {iss.message}
                      </span>
                    ))}
                  </div>
                )}
              />
            </DataTable>
          </div>
        )}

        {result && result.problemCount === 0 && (
          <Text
            value={`No file integrity issues found across ${result.checkedCount} upload(s).`}
            size={12}
            color="#7fdc96"
            style={{ marginTop: 10 }}
          />
        )}
      </Flex>
    </div>
  )
}

const OldUpdatesCleanupSection = ({
  project,
  onOpenUpload,
}: {
  project: string
  onOpenUpload?: (upload: UploadRecord) => void
}) => {
  const [olderThanDays, setOlderThanDays] = useState(90)
  const [calculating, setCalculating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [result, setResult] = useState<CleanupResult | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const handleCalculate = async (daysOverride?: number) => {
    const days = daysOverride ?? olderThanDays
    setCalculating(true)
    setResult(null)
    try {
      const res = await FC.client.service('utils').get('oldUpdatesCleanupCandidates', {
        query: { project, olderThanDays: days },
      })
      if (isCleanupResult(res)) setResult({ ...res, computedForDays: days })
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Calculation failed', detail: e.message })
    }
    setCalculating(false)
  }

  // Auto-load only on mount and when the project changes (e.g. user switches
  // to a different app). Editing the Window input no longer triggers a
  // request — user has to click Recalculate explicitly.
  useEffect(() => {
    handleCalculate(olderThanDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  const handleOpenCandidate = async (candidate: UploadRecord) => {
    if (!candidate?._id) return
    setOpening(candidate._id)
    try {
      const upload = (await FC.client.service('uploads').get(candidate._id)) as UploadRecord
      onOpenUpload?.(upload)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Failed to load upload', detail: e.message })
    }
    setOpening(null)
  }

  const runCleanup = async () => {
    if (!result?.count) return
    const computedForDays = result.computedForDays
    setConfirming(false)
    setDeleting(true)
    try {
      const res = (await FC.client.service('utils').update('cleanupOldUpdates', {
        project,
        olderThanDays: computedForDays,
      })) as CleanupResult
      invalidateQuery(['uploads', 'published', 'diskUsage'])
      const errorCount = res?.errors?.length || 0
      const detailLines = [
        `Freed ${fmtBytes(res?.totalBytes || 0)}`,
        `zips: ${res?.zipsRemoved || 0} removed${res?.zipsMissing ? `, ${res.zipsMissing} missing` : ''}`,
        `dirs: ${res?.dirsRemoved || 0} removed${res?.dirsMissing ? `, ${res.dirsMissing} missing` : ''}`,
      ]
      if (errorCount) detailLines.push(`${errorCount} file error(s) — check API logs`)
      window.toast?.show({
        severity: errorCount ? 'warn' : 'info',
        summary: `Removed ${res?.removed || 0} old updates`,
        detail: detailLines.join(' · '),
      })
      // Recompute with the same window so the user sees the post-cleanup
      // state (ideally 0 candidates) without an extra manual click.
      await handleCalculate(computedForDays)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Cleanup failed', detail: e.message })
    }
    setDeleting(false)
  }

  const canShowDelete = result !== null && !calculating && !deleting

  return (
    <div style={{ width: '100%' }}>
      <Flex fw as style={{ gap: 12, padding: 10 }}>
        <Text
          value="Delete old, non-released updates: anything created more than N days ago that no device currently has installed. Only currently-released updates are excluded — everything else (obsolete, ready, …) is eligible."
          size={12}
          color="rgba(255,255,255,0.6)"
        />

        <Flex row style={{ gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <Flex as>
            <Text value="Window (days)" size={11} color="rgba(255,255,255,0.5)" />
            <input
              type="number"
              min={1}
              max={365}
              value={olderThanDays}
              disabled={calculating || deleting}
              onChange={(e) => setOlderThanDays(Math.max(1, parseInt(e.target.value) || 30))}
              style={{
                width: 80,
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(20,26,37,1)',
                color: Colors.text,
                fontSize: 14,
              }}
            />
          </Flex>

          {result && (
            <>
              <Flex as>
                <Text value="Candidates" size={11} color="rgba(255,255,255,0.5)" />
                <Text value={String(result.count)} bold size={20} />
              </Flex>

              <Flex as>
                <Text value="Space to free" size={11} color="rgba(255,255,255,0.5)" />
                <Text value={fmtBytes(result.totalBytes)} bold size={20} />
              </Flex>
            </>
          )}
        </Flex>

        <Flex row style={{ marginTop: 10, gap: 10 }}>
          {calculating ? (
            <Spinner />
          ) : (
            <Button
              icon="calculator"
              label={result ? 'Recalculate' : 'Calculate candidates'}
              onClick={() => handleCalculate(olderThanDays)}
              disabled={deleting}
            />
          )}

          {canShowDelete &&
            (deleting ? (
              <Spinner />
            ) : (
              <Button
                icon="trash"
                label={result.count ? `Delete ${result.count} old update(s)` : 'Nothing to delete'}
                disabled={!result.count}
                danger={!!result.count}
                onClick={() => setConfirming(true)}
              />
            ))}
        </Flex>

        {result && result.count > 0 && (
          <div style={{ width: '100%', marginTop: 16 }}>
            <DataTable
              value={result.candidates || []}
              size="small"
              paginator={(result.candidates || []).length > 10}
              rows={10}
              sortField="createdAt"
              sortOrder={1}
              style={{ width: '100%' }}>
              <Column
                field="updateId"
                header="Update ID"
                sortable
                filter
                body={(row) => (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenCandidate(row)
                    }}
                    title={opening === row._id ? 'Loading…' : 'Open update details'}
                    style={{
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 12,
                      wordBreak: 'break-all',
                      cursor: 'pointer',
                      color: Colors.primary,
                      textDecoration: 'underline dotted',
                      opacity: opening === row._id ? 0.5 : 1,
                    }}>
                    {row.updateId || '—'}
                  </span>
                )}
              />
              <Column
                field="createdAt"
                header="Created"
                sortable
                style={{ width: 170 }}
                body={(row) => (
                  <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {row.createdAt ? moment(row.createdAt).format('YYYY-MM-DD HH:mm:ss') : '—'}
                  </span>
                )}
              />
              <Column field="version" header="Version" sortable filter style={{ width: 100 }} />
              <Column field="releaseChannel" header="Channel" sortable filter style={{ width: 130 }} />
              <Column field="status" header="Status" sortable filter style={{ width: 110 }} />
              <Column
                field="sizeBytes"
                header="Size"
                sortable
                style={{ width: 100 }}
                body={(row) => (row.sizeBytes == null ? '—' : fmtBytes(row.sizeBytes))}
              />
            </DataTable>
          </div>
        )}

        {result && result.count === 0 && (
          <Text
            value={`No non-released updates older than ${result.computedForDays} day${result.computedForDays === 1 ? '' : 's'} are safe to delete right now.`}
            size={12}
            color="rgba(255,255,255,0.5)"
            style={{ marginTop: 10 }}
          />
        )}
      </Flex>

      <ConfirmDialog
        visible={confirming}
        title="Delete Old Updates"
        confirmIcon="trash"
        confirmLabel={result?.count ? `Delete ${result.count} update(s)` : 'Delete'}
        confirmDanger
        onConfirm={runCleanup}
        onCancel={() => setConfirming(false)}
        loading={deleting}>
        {result && (
          <>
            <Text
              value={`You are about to delete ${result.count} update(s) (${fmtBytes(result.totalBytes)}) that no client has used in the last ${result.computedForDays} day${result.computedForDays === 1 ? '' : 's'}.`}
            />
            <Text
              value="Only currently-released updates are excluded — everything else (obsolete, ready, …) is eligible."
              style={{ marginTop: 20 }}
            />
            <Text value="This permanently removes files and database records." style={{ marginTop: 20 }} />
            <Text value="Are you sure?" style={{ marginTop: 20 }} />
          </>
        )}
      </ConfirmDialog>
    </div>
  )
}

const OrphanFilesSection = ({ project }) => {
  const [scanning, setScanning] = useState(false)
  const [busyPath, setBusyPath] = useState(null)
  const [result, setResult] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null) // orphan being confirmed

  const handleScan = async () => {
    setScanning(true)
    setResult(null)
    try {
      const res = await FC.client.service('utils').update('scanOrphans', { project })
      setResult(res)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Scan failed', detail: e.message })
    }
    setScanning(false)
  }

  const runDelete = async () => {
    const orphan = pendingDelete
    if (!orphan) return
    setPendingDelete(null)
    setBusyPath(orphan.path)
    try {
      await FC.client.service('utils').update('deleteOrphan', { path: orphan.path, type: orphan.type })
      invalidateQuery(['diskUsage'])
      window.toast?.show({ severity: 'info', summary: 'Deleted', detail: orphan.path })
      await handleScan()
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Delete failed', detail: e.message })
    }
    setBusyPath(null)
  }

  return (
    <div style={{ width: '100%' }}>
      <Flex fw as style={{ gap: 12, padding: 10 }}>
        <Text
          value="Find files on disk that no upload record references. These may be leftovers from interrupted uploads, manual file operations, or restore-from-backup with missing DB rows."
          size={12}
          color="rgba(255,255,255,0.6)"
        />

        <Flex row style={{ gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          {result && (
            <>
              <Flex as>
                <Text value="Total orphans" size={11} color="rgba(255,255,255,0.5)" />
                <Text
                  value={String(result.orphanCount)}
                  bold
                  size={20}
                  color={result.orphanCount > 0 ? '#ffb300' : undefined}
                />
              </Flex>
              <Flex as>
                <Text value="Orphan zips" size={11} color="rgba(255,255,255,0.5)" />
                <Text value={String(result.zipCount)} bold size={20} />
              </Flex>
              <Flex as>
                <Text value="Orphan dirs" size={11} color="rgba(255,255,255,0.5)" />
                <Text value={String(result.dirCount)} bold size={20} />
              </Flex>
              <Flex as>
                <Text value="Total size" size={11} color="rgba(255,255,255,0.5)" />
                <Text value={fmtBytes(result.totalBytes)} bold size={20} />
              </Flex>
            </>
          )}
        </Flex>

        <Flex row style={{ marginTop: 10 }}>
          {scanning ? (
            <Spinner />
          ) : (
            <Button icon="search" label={result ? 'Re-scan' : 'Scan for orphan files'} onClick={handleScan} />
          )}
        </Flex>

        {result && result.orphanCount > 0 && (
          <div style={{ width: '100%', marginTop: 16 }}>
            <DataTable
              value={result.orphans}
              size="small"
              paginator={result.orphans.length > 10}
              rows={10}
              sortField="sizeBytes"
              sortOrder={-1}
              style={{ width: '100%' }}>
              <Column field="type" header="Type" sortable filter style={{ width: 80 }} />
              <Column
                field="path"
                header="Path"
                sortable
                filter
                body={(row) => (
                  <span
                    style={{
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 12,
                      wordBreak: 'break-all',
                    }}>
                    {row.path}
                  </span>
                )}
              />
              <Column field="version" header="Version" sortable filter style={{ width: 90 }} />
              <Column
                field="sizeBytes"
                header="Size"
                sortable
                style={{ width: 100 }}
                body={(row) => fmtBytes(row.sizeBytes)}
              />
              <Column
                field="modifiedAt"
                header="Modified"
                sortable
                style={{ width: 170 }}
                body={(row) => (
                  <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {row.modifiedAt ? moment(row.modifiedAt).format('YYYY-MM-DD HH:mm:ss') : '—'}
                  </span>
                )}
              />
              <Column
                header="Actions"
                style={{ width: 110 }}
                body={(row) => (
                  <Button
                    icon="trash"
                    label="Delete"
                    danger
                    disabled={busyPath === row.path}
                    onClick={() => setPendingDelete(row)}
                    style={{ padding: '2px 8px', fontSize: 11 }}
                  />
                )}
              />
            </DataTable>
          </div>
        )}

        {result && result.orphanCount === 0 && (
          <Text
            value="No orphan files found — DB and filesystem are in sync."
            size={12}
            color="#7fdc96"
            style={{ marginTop: 10 }}
          />
        )}
      </Flex>

      <ConfirmDialog
        visible={!!pendingDelete}
        title="Delete Orphan File"
        confirmIcon="trash"
        confirmLabel="Delete"
        confirmDanger
        onConfirm={runDelete}
        onCancel={() => setPendingDelete(null)}
        loading={!!busyPath}>
        {pendingDelete && (
          <>
            <Text value={`You are about to delete an orphan ${pendingDelete.type}:`} />
            <Text
              value={pendingDelete.path}
              style={{
                marginTop: 12,
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 12,
                wordBreak: 'break-all',
              }}
            />
            <Text value={`Size: ${fmtBytes(pendingDelete.sizeBytes)}`} style={{ marginTop: 8 }} />
            <Text value="Are you sure?" style={{ marginTop: 20 }} />
          </>
        )}
      </ConfirmDialog>
    </div>
  )
}

export const ReleaseManager = ({ app }: { app: AppRecord }) => {
  const { data: uploadsResult, isSuccess } = useCQuery<ListResult<UploadRecord>>(['uploads', app._id])
  const uploads = listFromResult(uploadsResult)
  const [update, setUpdate] = useState<UploadRecord | null>(null)
  const [releasing, setRelasing] = useState(false)

  if (!isSuccess) return <Spinner />

  if (!uploads.length) {
    return (
      <Card {...cardProps}>
        <UpdateInstructions app={app} />
      </Card>
    )
  }

  return (
    <Card {...cardProps}>
      <TabView style={{ width: '100%', marginTop: 10 }} renderActiveOnly={false}>
        <TabPanel header="All Updates">
          <DataTable
            style={{ marginTop: 10, width: '100%' }}
            value={uploads}
            paginator
            rows={10}
            emptyMessage="No app versions yet">
            <Column
              field="updateId"
              header="Update ID"
              filter
              sortable
              body={(row) => (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    setUpdate(row)
                  }}
                  title="Open update details"
                  style={{
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 12,
                    wordBreak: 'break-all',
                    cursor: 'pointer',
                    color: Colors.primary,
                    textDecoration: 'underline dotted',
                  }}>
                  {row.updateId || '—'}
                </span>
              )}
            />
            <Column
              field="createdAt"
              header="Created"
              sortable
              body={({ createdAt }) => moment(createdAt).format('YYYY-MM-DD HH:mm:ss')}
            />
            <Column field="releaseChannel" header="Channel" filter sortable />
            <Column field="version" header="Version" filter sortable />
            <Column
              field="status"
              header="Status"
              filter
              sortable
              body={({ status }) => <StatusPill status={status} />}
            />
          </DataTable>
        </TabPanel>
        <TabPanel header="Old Updates Cleanup">
          <OldUpdatesCleanupSection project={app._id} onOpenUpload={setUpdate} />
        </TabPanel>
        <TabPanel header="Integrity Check">
          <IntegrityCheckSection project={app._id} onOpenUpload={setUpdate} />
        </TabPanel>
        <TabPanel header="Orphan Files">
          <OrphanFilesSection project={app._id} />
        </TabPanel>
      </TabView>

      <Release update={update} releaseState={[releasing, setRelasing]} onHide={() => setUpdate(null)} />
    </Card>
  )
}

const cardProps = {
  title: 'RELEASE MANAGER',
  collapsable: true,
  collapsed: false,
  fadeIn: true,
  style: { padding: 20, width: '100%', maxWidth: 900, marginTop: 20 },
}
