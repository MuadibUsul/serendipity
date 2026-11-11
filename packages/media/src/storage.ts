export interface UploadForm {
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** The only storage operations the service needs; no public ACL or unsigned read. */
export interface MediaStorage {
  uploadForm(
    key: string,
    contentType: string,
    maxBytes: number,
    ttlSeconds: number,
  ): Promise<UploadForm>;
  describe(key: string): Promise<{
    contentType: string;
    bytes: number;
    encryptedWithKms: boolean;
    imageSignatureValid: boolean;
  } | null>;
  readUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
