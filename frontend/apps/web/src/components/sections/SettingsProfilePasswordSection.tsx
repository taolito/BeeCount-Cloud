import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  useT,
  useToast,
} from '@beecount/ui'
import { ApiError, changeMyPassword } from '@beecount/api-client'

import { useAuth } from '../../context/AuthContext'
import { localizeError } from '../../i18n/errors'

// 与 server UserProfilePasswordRequest / register 的口径一致。
const MIN_NEW_PASSWORD = 6

/**
 * 设置 - 修改密码小节。
 *
 * 普通用户没有管理员权限，改不了 `/admin/users/{id}/password`，这里走
 * `POST /profile/password`：带当前密码做二次确认，成功后服务端吊销该用户
 * 全部 refresh token（其它设备下次刷新即失效），当前会话主动 logout，
 * 让用户用新密码重登 —— 旧 access token 还在有效期内，不登出等于白改。
 */
export function SettingsProfilePasswordSection() {
  const t = useT()
  const toast = useToast()
  const { token, logout } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSubmit =
    !saving &&
    currentPassword.length > 0 &&
    newPassword.length >= MIN_NEW_PASSWORD &&
    newPassword === confirmPassword

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      await changeMyPassword(token, currentPassword, newPassword)
      toast.success(t('profile.password.saved'))
      logout()
    } catch (err) {
      // 401 在这个端点专指「当前密码不对」，直接给明确文案，别把 server 的
      // "Invalid password." 丢给用户。
      toast.error(
        err instanceof ApiError && err.status === 401
          ? t('profile.password.error.currentWrong')
          : localizeError(err, t)
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="bc-panel">
      <CardHeader>
        <CardTitle>{t('profile.password.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('profile.password.desc')}</p>
        <div className="max-w-sm space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="profile-password-current" className="text-sm font-medium">
              {t('profile.password.current')}
            </label>
            <Input
              id="profile-password-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t('profile.password.currentPlaceholder') as string}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="profile-password-new" className="text-sm font-medium">
              {t('profile.password.new')}
            </label>
            <Input
              id="profile-password-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('profile.password.newPlaceholder') as string}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="profile-password-confirm" className="text-sm font-medium">
              {t('profile.password.confirm')}
            </label>
            <Input
              id="profile-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('profile.password.confirmPlaceholder') as string}
              disabled={saving}
              aria-invalid={mismatch}
            />
            {mismatch && (
              <p className="text-xs text-destructive">{t('profile.password.mismatch')}</p>
            )}
          </div>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('profile.password.submit')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
