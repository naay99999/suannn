export function registrationSuccessMessage(result: { accepted: true; next: 'sign-in' }) {
  if (result.next !== 'sign-in') throw new Error('Unexpected registration response')
  return 'หากอีเมลนี้ใช้ลงทะเบียนได้ โปรดตรวจกล่องจดหมายเพื่อยืนยันอีเมล แล้วเข้าสู่ระบบ'
}
