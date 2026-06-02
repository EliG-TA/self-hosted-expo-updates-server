import { useEffect, useState } from 'react'
import { Dialog } from 'primereact/dialog'

import { Button, Flex, Spinner, Text } from '../../Components'
import { FC, invalidateQuery } from '../../Services'
import type { IntegrityRecord, ServiceOutcome, UploadRecord } from '../../types'
import { UpdateInfo } from './UpdateInfo'

interface ReleaseProps {
  update: UploadRecord | null
  onHide: () => void
  releaseState?: unknown
}

interface IntegrityResponse {
  problems?: IntegrityRecord[]
}

const emptyIntegrity: IntegrityRecord = { errorCount: 0, warningCount: 0, issues: [] }

export const Release = ({ update, onHide }: ReleaseProps) => {
  const [releasing, setRelasing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [purging, setPurging] = useState(false)
  const [activeTab, setActiveTab] = useState(UpdateInfo.OVERVIEW_TAB_INDEX)
  const [integrity, setIntegrity] = useState<IntegrityRecord | null>(null)
  const [integrityLoading, setIntegrityLoading] = useState(false)

  // Reset to the Overview tab + re-check integrity whenever a different
  // update is opened. Empty issues result is treated as "all green" so the
  // Release/Rollback action is enabled.
  useEffect(() => {
    setActiveTab(UpdateInfo.OVERVIEW_TAB_INDEX)
    setIntegrity(null)
    if (!update?._id) return
    setIntegrityLoading(true)
    FC.client
      .service('utils')
      .update('checkIntegrity', { uploadId: update._id })
      .then((res) => {
        const typed = res as IntegrityResponse
        const row = typed?.problems?.[0]
        setIntegrity(row || emptyIntegrity)
      })
      .catch(() => setIntegrity(emptyIntegrity))
      .finally(() => setIntegrityLoading(false))
  }, [update?._id])

  const isReleased = update?.status === 'released'
  const isObsolete = update?.status === 'obsolete'
  const isDeleted = update?.status === 'deleted'
  const hasIntegrityErrors = (integrity?.errorCount || 0) > 0

  const ACTION_SUCCESS_VERB: Record<string, string> = {
    release: 'published',
    delete: 'deleted',
    purgeDeleted: 'purged',
  }

  const handleAction = (action: string) => async () => {
    setDeleting(false)
    setConfirming(false)
    setPurging(false)
    setRelasing(true)
    try {
      const outcome = (await FC.client.service('utils').update(action, { uploadId: update._id })) as ServiceOutcome
      if (!outcome || outcome?.error) throw new Error(outcome?.error || 'Unknown error')

      window.toast.show({
        severity: 'info',
        summary: 'Success',
        detail: `Update succesfully ${ACTION_SUCCESS_VERB[action] || 'processed'}.`,
      })
    } catch (e) {
      window.toast.show({
        severity: 'error',
        summary: 'Error',
        detail: e.message,
      })
    }
    invalidateQuery(['uploads', 'published'])
    onHide()
    setRelasing(false)
  }

  const actionLabel = isReleased ? 'App is currently released' : isObsolete ? 'Rollback' : 'Release'

  const releaseDisabled = isReleased || isDeleted || hasIntegrityErrors || integrityLoading
  const releaseTitle = isReleased
    ? 'Already released'
    : hasIntegrityErrors
      ? `Release blocked: ${integrity.errorCount} integrity error(s). Fix the files or re-upload before releasing.`
      : 'Release this update'

  // Footer is pinned to the bottom of the Dialog by PrimeReact and the body
  // scrolls above it. Render the actions only on the Overview tab so the
  // JSON views get the full vertical space.
  const dialogFooter =
    activeTab === UpdateInfo.OVERVIEW_TAB_INDEX ? (
      releasing ? (
        <Flex row fw jc>
          <Spinner />
        </Flex>
      ) : (
        <Flex fw as style={{ gap: 10 }}>
          {hasIntegrityErrors && (
            <div
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                background: 'rgba(239, 83, 80, 0.12)',
                border: '1px solid rgba(239, 83, 80, 0.4)',
              }}>
              <Text
                value={`Integrity check failed — ${integrity.errorCount} error(s) detected. Release/rollback disabled.`}
                size={12}
                color="#ef9a9a"
                bold
              />
              {integrity.issues
                .filter((i) => i.severity === 'error')
                .slice(0, 4)
                .map((iss, i) => (
                  <Text key={i} value={`• ${iss.message}`} size={11} color="#ef9a9a" />
                ))}
              {integrity.issues.filter((i) => i.severity === 'error').length > 4 && (
                <Text value="…and more (see Integrity Check tab)" size={11} color="#ef9a9a" />
              )}
            </div>
          )}
          <Flex row fw jb>
            {!isDeleted && (
              <Button
                disabled={releaseDisabled}
                icon="upload"
                label={actionLabel}
                onClick={() => setConfirming(true)}
                tooltip={releaseTitle}
                title={releaseTitle}
              />
            )}
            {isDeleted ? (
              <Button
                icon="trash"
                label="PURGE PERMANENTLY"
                danger
                onClick={() => setPurging(true)}
                title="Remove the tombstone row from the database. This cannot be undone."
              />
            ) : (
              <Button disabled={isReleased} icon="trash" label="DELETE" danger onClick={() => setDeleting(true)} />
            )}
          </Flex>
        </Flex>
      )
    ) : null

  if (!update) return null
  return (
    <>
      <Dialog
        visible={!!update?._id}
        modal
        onHide={releasing ? () => null : onHide}
        style={{ width: '100%', maxWidth: 800, margin: 20 }}
        header={<Text value="Upload Details" bold size={28} />}
        footer={dialogFooter}>
        <Flex fw as>
          <UpdateInfo update={update} activeIndex={activeTab} onTabChange={setActiveTab} />
        </Flex>
      </Dialog>

      <Dialog
        visible={confirming}
        modal
        style={{ width: '100%', maxWidth: 600 }}
        onHide={() => setConfirming(false)}
        header={<Text value="Release Upload to Apps" bold size={28} />}>
        <Text value={`You are about to release ${update.updateId} to all users in this Release Channel / Version.`} />
        {update.status === 'obsolete' && (
          <Text
            value="This upload was released in the past before the current one, if you continue users will update to this older version."
            style={{ marginTop: 20 }}
          />
        )}
        <Text value="Are you sure?" style={{ marginTop: 20 }} />

        <Flex jb row fw style={{ marginTop: 20 }}>
          <Button icon="ban" label="Cancel" onClick={() => setConfirming(false)} />
          <Button icon="check" label={actionLabel} onClick={handleAction('release')} />
        </Flex>
      </Dialog>

      <Dialog
        visible={deleting}
        modal
        style={{ width: '100%', maxWidth: 600 }}
        onHide={() => setDeleting(false)}
        header={<Text value="Delete Upload" bold size={28} />}>
        <Text
          value={`You are about to delete ${update.updateId}, all related files will be permanently removed from the server.`}
        />
        <Text value="Are you sure?" style={{ marginTop: 20 }} />

        <Flex jb row fw style={{ marginTop: 20 }}>
          <Button icon="ban" label="Cancel" onClick={() => setDeleting(false)} />
          <Button icon="check" label="DELETE" danger onClick={handleAction('delete')} />
        </Flex>
      </Dialog>

      <Dialog
        visible={purging}
        modal
        style={{ width: '100%', maxWidth: 600 }}
        onHide={() => setPurging(false)}
        header={<Text value="Purge Upload Record" bold size={28} />}>
        <Text
          value={`You are about to permanently remove the database record for ${update.updateId}. The disk files were already deleted at soft-delete time; this drops the tombstone row, so stats can no longer resolve client telemetry referencing this updateId.`}
        />
        <Text value="This action cannot be undone. Are you sure?" style={{ marginTop: 20 }} />

        <Flex jb row fw style={{ marginTop: 20 }}>
          <Button icon="ban" label="Cancel" onClick={() => setPurging(false)} />
          <Button icon="check" label="PURGE" danger onClick={handleAction('purgeDeleted')} />
        </Flex>
      </Dialog>
    </>
  )
}
