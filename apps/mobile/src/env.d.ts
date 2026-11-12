// Build-time variables Expo inlines. They must be read as
// `process.env.EXPO_PUBLIC_…` (dot access) for the inlining to work.
declare namespace NodeJS {
  interface ProcessEnv {
    /** The mock account state to start in: new | matching | booked | in_relationship. */
    readonly EXPO_PUBLIC_MOCK_STATE?: string;
  }
}
