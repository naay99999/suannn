export {}

declare global {
  const Bun: {
    file(path: string | URL): {
      text(): Promise<string>
    }
    CryptoHasher: new (algorithm: 'sha256') => {
      update(value: string): {
        digest(): Buffer
        digest(encoding: 'hex'): string
      }
    }
  }
}
