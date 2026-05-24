import { Dialog } from 'primereact/dialog'
import { Flex } from './Flex'
import { Text } from './Text'
import { Button } from './Button'

// Reusable styled confirm dialog that mirrors the look of the Release /
// Delete prompts in Release.tsx, so destructive actions across the app
// have a consistent visual language instead of falling back to the
// browser-default window.confirm().
//
// `loading` disables the buttons and blocks the close affordance so the
// dialog can't be dismissed mid-request.
export const ConfirmDialog = ({
  visible,
  title,
  children,
  confirmLabel = 'Confirm',
  confirmIcon = 'check',
  cancelLabel = 'Cancel',
  cancelIcon = 'ban',
  onConfirm,
  onCancel,
  loading = false
}) => {
  if (!visible) return null
  return (
    <Dialog
      visible
      modal
      style={{ width: '100%', maxWidth: 600 }}
      onHide={loading ? () => null : onCancel}
      header={<Text value={title} bold size={28} />}
    >
      {children}
      <Flex jb row fw style={{ marginTop: 20 }}>
        <Button icon={cancelIcon} label={cancelLabel} onClick={onCancel} disabled={loading} />
        <Button icon={confirmIcon} label={confirmLabel} onClick={onConfirm} disabled={loading} />
      </Flex>
    </Dialog>
  )
}
