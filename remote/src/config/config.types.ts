export interface AppCredentials {
    clientId: string
    clientSecret: string
}

export interface RemoteConfig {
    baseUrl: URL
    blockedAddresses: string[]
    databasePath: string
    encryptionKey: Buffer
    github?: AppCredentials
    githubAppSlug?: string
    gitlab?: AppCredentials
    port: number
}
