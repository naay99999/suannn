import { TotpEnrollment } from './_components/totp-enrollment'

export function Component() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">Set up your authenticator</h1>
          <p className="text-sm text-muted-foreground">Staff accounts require an authenticator code at sign in.</p>
        </div>
        <TotpEnrollment />
      </div>
    </main>
  )
}
