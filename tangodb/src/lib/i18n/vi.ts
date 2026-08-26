import { EN } from "./en";
import type { I18nKey } from "./keys";

/** Vietnamese overrides; missing keys fall back to EN then RU in core.ts */
const VI_OVERRIDES: Partial<Record<I18nKey, string>> = {
  "team.title": "Đội ngũ",
  "team.subtitle": "Thành viên, lời mời và vai trò",
  "team.members": "Thành viên",
  "team.invite": "Mời",
  "team.inviteEmail": "Email",
  "team.inviteRole": "Vai trò",
  "team.sendInvite": "Tạo lời mời",
  "team.inviteLinkHint": "Lời mời sẽ được gửi qua email. CRM không hiển thị liên kết.",
  "team.pendingInvites": "Lời mời đang chờ",
  "team.revoke": "Thu hồi",
  "team.deactivate": "Vô hiệu hóa",
  "team.changeRole": "Đổi vai trò",
  "team.audit": "Nhật ký thay đổi",
  "team.inviteSuccess": "Đã tạo lời mời",
  "team.inviteEmailSent": "Đã gửi lời mời qua email",
  "team.inviteManualHint": "Không gửi được email. Thử lại sau hoặc kiểm tra cài đặt gửi thư.",
  "team.inviteError": "Không gửi được lời mời",
  "team.noMembers": "Không có thành viên",
  "team.inactive": "Không hoạt động",
  "team.recoveryTitle": "Khôi phục quyền truy cập thành viên",
  "team.recoveryForgotPassword":
    "Quên mật khẩu — thành viên yêu cầu đặt lại trên trang đăng nhập. Email chỉ được gửi nếu địa chỉ còn dùng được.",
  "team.recoveryLostEmail":
    "Mất email — vô hiệu hóa thành viên cũ, sau đó gửi lời mời mới tới email mới (vai trò và quyền giữ qua «Mời lại»).",
  "team.recoveryOwnerNote":
    "Quyền truy cập chủ sở hữu CRM không khôi phục từ trang này. Chủ: đặt lại mật khẩu qua email hoặc liên hệ nhà phát triển nếu mất email.",
  "team.deactivateConfirmTitle": "Vô hiệu hóa thành viên?",
  "team.deactivateConfirmBody":
    "Thành viên sẽ mất quyền truy cập CRM. Nếu không còn email, gửi lời mời mới tới địa chỉ khác.",
  "team.deactivateSuccess": "Đã vô hiệu hóa. Gửi lời mời mới nếu cần.",
  "team.reinvite": "Mời lại",
  "team.reinviteHint": "Vai trò và quyền đã điền — nhập email mới và gửi lời mời.",
  "auth.forgotPasswordSuccess": "Nếu tài khoản tồn tại, chúng tôi đã gửi liên kết đặt lại mật khẩu.",
  "auth.acceptInvite": "Chấp nhận lời mời",
  "auth.acceptInviteHint": "Đăng nhập bằng email trong lời mời",
  "auth.acceptInviteSetupHint":
    "Email này chưa có tài khoản TangoDB. Nhập địa chỉ trong thư mời và đặt mật khẩu.",
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

export const VI: Partial<Record<I18nKey, string>> = { ...EN, ...VI_OVERRIDES };
