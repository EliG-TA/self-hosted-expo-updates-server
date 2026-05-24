import { useState, useEffect } from 'react'
import { Dialog } from 'primereact/dialog'

import { FC, invalidateQuery } from '../../Services'
import { UpdateInfo } from './UpdateInfo'
import { Flex, Button, Text, Spinner } from '../../Components'

export const Release = ({ update, onHide }) => {
  const [releasing, setRelasing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [activeTab, setActiveTab] = useState(UpdateInfo.OVERVIEW_TAB_INDEX)
  const [integrity, setIntegrity] = useState(null) // { errorCount, warningCount, issues } | null
  const [integrityLoading, setIntegrityLoading] = useState(false)

  // Reset to the Overview tab + re-check integrity whenever a different
  // update is opened. Empty issues result is treated as "all green" so the
  // Release/Rollback action is enabled.
  useEffect(() => {
    setActiveTab(UpdateInfo.OVERVIEW_TAB_INDEX)
    setIntegrity(null)
    if (!update?._id) return
    setIntegrityLoading(true)
    FC.client.service('utils').update('checkIntegrity', { uploadId: update._id })
      .then(res => {
        const row = res?.problems?.[0]
        setIntegrity(row || { errorCount: 0, warningCount: 0, issues: [] })
      })
      .catch(() => setIntegrity({ errorCount: 0, warningCount: 0, issues: [] }))
      .finally(() => setIntegrityLoading(false))
  }, [update?._id])

  const isReleased = update?.status === 'released'
  const isObsolete = update?.status === 'obsolete'
  const hasIntegrityErrors = (integrity?.errorCount || 0) > 0

  const handleAction = (action) => async () => {
    setDeleting(false)
    setConfirming(false)
    setRelasing(true)
    try {
      const outcome = await FC.client.service('utils').update(action, { uploadId: update._id })
      if (!outcome || outcome?.error) throw new Error(outcome?.error || 'Unknown error')

      window.toast.show({
        severity: 'info',
        summary: 'Success',
        detail: `Update succesfully ${action === 'release' ? 'published' : 'deleted'}.`
      })
    } catch (e) {
      window.toast.show({
        severity: 'error',
        summary: 'Error',
        detail: e.message
      })
    }
    invalidateQuery(['uploads', 'published'])
    onHide()
    setRelasing(false)
  }

  const actionLabel = isReleased
    ? 'App is currently released'
    : (isObsolete ? 'Rollback' : 'Release')

  const releaseDisabled = isReleased || hasIntegrityErrors || integrityLoading
  const releaseTitle = isReleased
    ? 'Already released'
    : (hasIntegrityErrors
        ? `Release blocked: ${integrity.errorCount} integrity error(s). Fix the files or re-upload before releasing.`
        : 'Release this update')

  // Footer is pinned to the bottom of the Dialog by PrimeReact and the body
  // scrolls above it. Render the actions only on the Overview tab so the
  // JSON views get the full vertical space.
  const dialogFooter = activeTab === UpdateInfo.OVERVIEW_TAB_INDEX
    ? (releasing
        ? <Flex row fw jc><Spinner /></Flex>
        : (
          <Flex fw as style={{ gap: 10 }}>
            {hasIntegrityErrors && (
              <div style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                background: 'rgba(239, 83, 80, 0.12)',
                border: '1px solid rgba(239, 83, 80, 0.4)'
              }}>
                <Text
                  value={`Integrity check failed — ${integrity.errorCount} error(s) detected. Release/rollback disabled.`}
                  size={12}
                  color='#ef9a9a'
                  bold
                />
                {integrity.issues.filter(i => i.severity === 'error').slice(0, 4).map((iss, i) => (
                  <Text key={i} value={`• ${iss.message}`} size={11} color='#ef9a9a' />
                ))}
                {integrity.issues.filter(i => i.severity === 'error').length > 4 && (
                  <Text value='…and more (see Integrity Check tab)' size={11} color='#ef9a9a' />
                )}
              </div>
            )}
            <Flex row fw jb>
              <Button
                disabled={releaseDisabled}
                icon='upload'
                label={actionLabel}
                onClick={() => setConfirming(true)}
                tooltip={releaseTitle}
                title={releaseTitle}
              />
              <Button disabled={isReleased} icon='trash' label='DELETE' onClick={() => setDeleting(true)} />
            </Flex>
          </Flex>
          ))
    : null

  if (!update) return null
  return (
    <>
      <Dialog
        visible={!!update?._id}
        modal
        onHide={releasing ? () => null : onHide}
        style={{ width: '100%', maxWidth: 800, margin: 20 }}
        header={<Text value='Upload Details' bold size={28} />}
        footer={dialogFooter}
      >
        <Flex fw as>
          <UpdateInfo update={update} activeIndex={activeTab} onTabChange={setActiveTab} />
        </Flex>
      </Dialog>

      <Dialog visible={confirming} modal style={{ width: '100%', maxWidth: 600 }} onHide={() => setConfirming(false)} header={<Text value='Release Upload to Apps' bold size={28} />}>
        <Text value={`You are about to release ${update.updateId} to all users in this Release Channel / Version.`} />
        {update.status === 'obsolete' && <Text value='This upload was released in the past before the current one, if you continue users will update to this older version.' style={{ marginTop: 20 }} />}
        <Text value='Are you sure?' style={{ marginTop: 20 }} />

        <Flex jb row fw style={{ marginTop: 20 }}>
          <Button icon='ban' label='Cancel' onClick={() => setConfirming(false)} />
          <Button icon='check' label={actionLabel} onClick={handleAction('release')} />
        </Flex>
      </Dialog>

      <Dialog visible={deleting} modal style={{ width: '100%', maxWidth: 600 }} onHide={() => setDeleting(false)} header={<Text value='Delete Upload' bold size={28} />}>
        <Text value={`You are about to delete ${update.updateId}, all related files will be permanently removed from the server.`} />
        <Text value='Are you sure?' style={{ marginTop: 20 }} />

        <Flex jb row fw style={{ marginTop: 20 }}>
          <Button icon='ban' label='Cancel' onClick={() => setDeleting(false)} />
          <Button icon='check' label='DELETE' onClick={handleAction('delete')} />
        </Flex>
      </Dialog>
    </>
  )
}
