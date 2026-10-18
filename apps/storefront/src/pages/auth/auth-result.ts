export type RegistrationResult = { accepted: true; next: 'sign-in' | 'verify-email' }

// Shown only when the account cannot be entered right away; the wording never confirms that an address is new.
export function registrationResultContent(result: RegistrationResult) {
  if (result.next === 'verify-email') {
    return {
      title: 'ตรวจอีเมลของคุณ',
      message: 'หากอีเมลนี้ใช้ลงทะเบียนได้ โปรดตรวจกล่องจดหมายเพื่อยืนยันอีเมล แล้วเข้าสู่ระบบ',
    }
  }
  if (result.next === 'sign-in') {
    return {
      title: 'เข้าสู่ระบบเพื่อเริ่มใช้งาน',
      message: 'หากอีเมลนี้ใช้ลงทะเบียนได้ คุณเข้าสู่ระบบด้วยอีเมลและรหัสผ่านนี้ได้ทันที',
    }
  }
  throw new Error('Unexpected registration response')
}

export const emailNotVerifiedMessage = 'ยืนยันอีเมลก่อนเข้าสู่ระบบ กรุณาตรวจกล่องจดหมายหรือขอลิงก์ยืนยันใหม่'
export const emailVerifiedMessage = 'ยืนยันอีเมลแล้ว เข้าสู่ระบบได้เลย'
export const verificationLinkFailedMessage = 'ลิงก์ยืนยันอีเมลใช้ไม่ได้หรือหมดอายุ เข้าสู่ระบบเพื่อขอลิงก์ใหม่'

export const emailChangedMessage = 'เปลี่ยนอีเมลแล้ว เข้าสู่ระบบอีกครั้งด้วยอีเมลใหม่'
