const { cloudinary, destroyQuietly } = require('../config/cloudinary');

/*
 * Guards the failure that had kept CI red since the first commit.
 *
 * Cleanup was written as `cloudinary.uploader.destroy(id, opts).catch(() => {})`, which handles a
 * rejected promise but not a synchronous throw. The SDK throws synchronously when it has no
 * credentials — and throws a plain object rather than an Error, so the error handler logged the
 * literal string "undefined". The throw escaped mid-handler, after the record had already been
 * soft-deleted, so the caller received a 500 for an operation that had actually succeeded.
 *
 * It surfaced only on CI because the two ways of lacking credentials differ: configured with
 * empty strings the SDK returns a promise, but with the variables genuinely unset it throws before
 * any promise exists. A developer machine with a populated .env therefore never saw it.
 */
describe('destroyQuietly', () => {
  const savedConfig = { ...cloudinary.config() };

  afterEach(() => cloudinary.config(savedConfig));

  it('swallows the synchronous throw raised when credentials are unset', () => {
    cloudinary.config({ cloud_name: undefined, api_key: undefined, api_secret: undefined });
    expect(() => destroyQuietly('skims/documents/abc', { resource_type: 'raw' })).not.toThrow();
  });

  it('still swallows failures when credentials are blank rather than absent', () => {
    cloudinary.config({ cloud_name: '', api_key: '', api_secret: '' });
    expect(() => destroyQuietly('skims/documents/abc', { resource_type: 'raw' })).not.toThrow();
  });

  it('does nothing without a public id', () => {
    cloudinary.config({ cloud_name: undefined, api_key: undefined, api_secret: undefined });
    expect(() => destroyQuietly(undefined)).not.toThrow();
    expect(() => destroyQuietly('')).not.toThrow();
  });

  // The precise shape the old `.catch()` could not handle: a synchronous throw of a non-Error,
  // which is why the logged message was `undefined` rather than anything diagnosable.
  it('confirms the SDK throws synchronously with a non-Error when unconfigured', () => {
    cloudinary.config({ cloud_name: undefined, api_key: undefined, api_secret: undefined });
    let thrown;
    try {
      cloudinary.uploader.destroy('skims/documents/abc', { resource_type: 'raw' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown instanceof Error).toBe(false);
    expect(thrown.message).toBeUndefined();
  });
});
