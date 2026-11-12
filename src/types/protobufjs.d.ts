// Type-only stub for 'protobufjs'.
//
// @cosmjs/proto-signing 0.38.1 and 0.39.0 (pulled in by @qorechain/sdk) publish declaration files
// with `import type protobuf from "protobufjs"` and use `protobuf.Reader` and `protobuf.Writer`.
// protobufjs is only a devDependency of cosmjs, so it is not installed and is never loaded at
// runtime. This stub declares just those two types, so the type check can keep checking every
// library declaration (no skipLibCheck). It declares no values: any runtime import of protobufjs
// still fails the type check and the build.

declare module 'protobufjs' {
  namespace protobuf {
    interface Reader {
      readonly buf: Uint8Array;
      pos: number;
      readonly len: number;
    }
    interface Writer {
      readonly len: number;
      finish(): Uint8Array;
    }
  }
  export = protobuf;
}
