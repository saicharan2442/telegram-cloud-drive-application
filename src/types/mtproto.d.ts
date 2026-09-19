declare module "@mtproto/core/envs/browser" {
  interface StorageInstance {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  }
  interface MTProtoOptions {
    api_id: number;
    api_hash: string;
    test?: boolean;
    storageOptions?: { instance?: StorageInstance };
  }
  export default class MTProto {
    constructor(options: MTProtoOptions);
    call<T = any>(
      method: string,
      params?: Record<string, unknown>,
      options?: { dcId?: number; syncAuth?: boolean },
    ): Promise<T>;
    setDefaultDc(dcId: number): Promise<void>;
    updates: { on(event: string, cb: (payload: any) => void): void; removeAllListeners?: () => void };
    crypto: {
      getSRPParams(args: {
        g: number;
        p: Uint8Array;
        salt1: Uint8Array;
        salt2: Uint8Array;
        gB: Uint8Array;
        password: string;
      }): Promise<{ A: Uint8Array; M1: Uint8Array }>;
    };
  }
}
