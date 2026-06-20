export type LocaleCode = "ru-RU" | "en-US" | "vi-VN";

export type I18nKey =
  | "team.title"
  | "team.subtitle"
  | "team.members"
  | "team.invite"
  | "team.inviteEmail"
  | "team.inviteRole"
  | "team.sendInvite"
  | "team.inviteLinkHint"
  | "team.pendingInvites"
  | "team.revoke"
  | "team.deactivate"
  | "team.changeRole"
  | "team.audit"
  | "team.inviteSuccess"
  | "team.inviteEmailSent"
  | "team.inviteManualHint"
  | "team.inviteError"
  | "team.noMembers"
  | "team.inactive"
  | "auth.acceptInvite"
  | "auth.acceptInviteHint"
  | "auth.acceptInviteSetupHint"
  | "auth.acceptInviteSubmit"
  | "auth.acceptInviteSuccess"
  | "auth.acceptInviteError"
  | "auth.loginRequired"
  | "auth.password"
  | "auth.confirmPassword"
  | "auth.passwordMinLength"
  | "auth.passwordMismatch"
  | "license.title"
  | "license.demo"
  | "license.lifetime"
  | "settings.nav";

const RU: Record<I18nKey, string> = {
  "team.title": "Команда",
  "team.subtitle": "Участники, приглашения и роли",
  "team.members": "Участники",
  "team.invite": "Пригласить",
  "team.inviteEmail": "Email",
  "team.inviteRole": "Роль",
  "team.sendInvite": "Сгенерировать приглашение",
  "team.inviteLinkHint": "После генерации скопируйте ссылку и отправьте её новому участнику команды",
  "team.pendingInvites": "Ожидающие приглашения",
  "team.revoke": "Отозвать",
  "team.deactivate": "Деактивировать",
  "team.changeRole": "Изменить роль",
  "team.audit": "Журнал изменений",
  "team.inviteSuccess": "Приглашение создано",
  "team.inviteEmailSent": "Приглашение отправлено на email",
  "team.inviteManualHint": "Письмо не отправлено — скопируйте ссылку и передайте преподавателю",
  "team.inviteError": "Не удалось отправить приглашение",
  "team.noMembers": "Нет участников",
  "team.inactive": "Неактивен",
  "auth.acceptInvite": "Принять приглашение",
  "auth.acceptInviteHint": "Войдите с email, указанным в приглашении",
  "auth.acceptInviteSetupHint": "Задайте пароль для входа в CRM",
  "auth.acceptInviteSubmit": "Принять приглашение и войти",
  "auth.acceptInviteSuccess": "Вы присоединились к организации",
  "auth.acceptInviteError": "Приглашение недействительно или истекло",
  "auth.loginRequired": "Войдите, чтобы принять приглашение",
  "auth.password": "Пароль",
  "auth.confirmPassword": "Подтверждение пароля",
  "auth.passwordMinLength": "Пароль должен содержать минимум 8 символов",
  "auth.passwordMismatch": "Пароли не совпадают",
  "license.title": "Лицензия",
  "license.demo": "Демо-доступ",
  "license.lifetime": "Пожизненная лицензия",
  "settings.nav": "Настройки CRM",
};

const EN: Record<I18nKey, string> = {
  "team.title": "Team",
  "team.subtitle": "Members, invites and roles",
  "team.members": "Members",
  "team.invite": "Invite",
  "team.inviteEmail": "Email",
  "team.inviteRole": "Role",
  "team.sendInvite": "Generate invite",
  "team.inviteLinkHint": "After generating, copy the link and send it to the new team member",
  "team.pendingInvites": "Pending invites",
  "team.revoke": "Revoke",
  "team.deactivate": "Deactivate",
  "team.changeRole": "Change role",
  "team.audit": "Change log",
  "team.inviteSuccess": "Invite created",
  "team.inviteEmailSent": "Invite sent to email",
  "team.inviteManualHint": "Email not sent — copy the link and share it with the teacher",
  "team.inviteError": "Failed to send invite",
  "team.noMembers": "No members",
  "team.inactive": "Inactive",
  "auth.acceptInvite": "Accept invitation",
  "auth.acceptInviteHint": "Sign in with the email from the invitation",
  "auth.acceptInviteSetupHint": "Set a password to sign in to the CRM",
  "auth.acceptInviteSubmit": "Accept invitation and sign in",
  "auth.acceptInviteSuccess": "You joined the organization",
  "auth.acceptInviteError": "Invite is invalid or expired",
  "auth.loginRequired": "Sign in to accept the invitation",
  "auth.password": "Password",
  "auth.confirmPassword": "Confirm password",
  "auth.passwordMinLength": "Password must be at least 8 characters",
  "auth.passwordMismatch": "Passwords do not match",
  "license.title": "License",
  "license.demo": "Demo access",
  "license.lifetime": "Lifetime license",
  "settings.nav": "CRM Settings",
};

const VI: Record<I18nKey, string> = {
  "team.title": "Đội ngũ",
  "team.subtitle": "Thành viên, lời mời và vai trò",
  "team.members": "Thành viên",
  "team.invite": "Mời",
  "team.inviteEmail": "Email",
  "team.inviteRole": "Vai trò",
  "team.sendInvite": "Tạo lời mời",
  "team.inviteLinkHint": "Sau khi tạo, sao chép liên kết và gửi cho thành viên mới",
  "team.pendingInvites": "Lời mời đang chờ",
  "team.revoke": "Thu hồi",
  "team.deactivate": "Vô hiệu hóa",
  "team.changeRole": "Đổi vai trò",
  "team.audit": "Nhật ký thay đổi",
  "team.inviteSuccess": "Đã tạo lời mời",
  "team.inviteEmailSent": "Đã gửi lời mời qua email",
  "team.inviteManualHint": "Email chưa gửi — sao chép liên kết và gửi cho giáo viên",
  "team.inviteError": "Không gửi được lời mời",
  "team.noMembers": "Không có thành viên",
  "team.inactive": "Không hoạt động",
  "auth.acceptInvite": "Chấp nhận lời mời",
  "auth.acceptInviteHint": "Đăng nhập bằng email trong lời mời",
  "auth.acceptInviteSetupHint": "Đặt mật khẩu để đăng nhập CRM",
  "auth.acceptInviteSubmit": "Chấp nhận lời mời và đăng nhập",
  "auth.acceptInviteSuccess": "Bạn đã tham gia tổ chức",
  "auth.acceptInviteError": "Lời mời không hợp lệ hoặc đã hết hạn",
  "auth.loginRequired": "Đăng nhập để chấp nhận lời mời",
  "auth.password": "Mật khẩu",
  "auth.confirmPassword": "Xác nhận mật khẩu",
  "auth.passwordMinLength": "Mật khẩu phải có ít nhất 8 ký tự",
  "auth.passwordMismatch": "Mật khẩu không khớp",
  "license.title": "Giấy phép",
  "license.demo": "Truy cập demo",
  "license.lifetime": "Giấy phép trọn đời",
  "settings.nav": "Cài đặt CRM",
};

const DICTS: Record<LocaleCode, Record<I18nKey, string>> = {
  "ru-RU": RU,
  "en-US": EN,
  "vi-VN": VI,
};

export function resolveLocale(locale?: string | null): LocaleCode {
  if (!locale) return "ru-RU";
  if (locale.startsWith("en")) return "en-US";
  if (locale.startsWith("vi")) return "vi-VN";
  return "ru-RU";
}

export function t(locale: string | null | undefined, key: I18nKey): string {
  const code = resolveLocale(locale);
  return DICTS[code][key] ?? DICTS["ru-RU"][key] ?? key;
}
