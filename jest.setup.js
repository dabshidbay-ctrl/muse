// Mock the native module that Jest cannot load.
jest.mock("@react-native-async-storage/async-storage", () => ({
  setItem: jest.fn(() => Promise.resolve(null)),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve(null)),
  clear: jest.fn(() => Promise.resolve(null)),
  getAllKeys: jest.fn(() => Promise.resolve([])),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiSet: jest.fn(() => Promise.resolve([])),
  multiRemove: jest.fn(() => Promise.resolve([])),
}));

// Mock Sentry so it does not try to initialise native modules.
jest.mock("@/lib/sentry", () => ({
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
  initSentry: jest.fn(),
  setSentryUser: jest.fn(),
}));

// Mock the Supabase client factory.
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
        order: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
        maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
        single: jest.fn(() => Promise.resolve({ data: null, error: null })),
      })),
      insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null, count: 0 })),
      })),
      rpc: jest.fn(() => Promise.resolve({ data: [], error: null })),
      upsert: jest.fn(() => Promise.resolve({ data: null, error: null })),
    })),
    rpc: jest.fn(() => Promise.resolve({ data: [], error: null })),
  })),
}));

// Mock expo modules that Jest cannot resolve.
jest.mock("expo-font", () => ({
  useFonts: jest.fn(() => [true]),
  isLoaded: true,
}));

jest.mock("expo-linking", () => ({
  createURL: jest.fn(() => "mock://url"),
  makeRedirectUri: jest.fn(() => "mock://redirect"),
}));

jest.mock("expo-auth-session", () => ({
  makeRedirectUri: jest.fn(() => "mock://redirect"),
}));

jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
  warmUpAsync: jest.fn(),
  coolDownAsync: jest.fn(),
  openBrowserAsync: jest.fn(),
}));

jest.mock("expo-constants", () => ({
  default: {
    manifest: { extra: {} },
    executionEnvironment: "storeClient",
  },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "00000000-0000-0000-0000-000000000000"),
  digestStringAsync: jest.fn(() => Promise.resolve("mock-digest")),
}));

jest.mock("react-native-url-polyfill", () => ({}));