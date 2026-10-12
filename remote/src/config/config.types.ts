export interface AppCredentials {
    clientId: string
    clientSecret: string
}

export interface GitLabInstance extends AppCredentials {
    host: string
}

export interface RemoteConfig {
    baseUrl: URL
    blockedAddresses: string[]
    databasePath: string
    encryptionKey: Buffer
    github?: AppCredentials
    githubAppSlug?: string
    gitlab?: AppCredentials
    gitlabInstances: GitLabInstance[]
    port: number
}
