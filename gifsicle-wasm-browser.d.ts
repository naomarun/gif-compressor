declare module "gifsicle-wasm-browser" {
  interface GifsicleInput {
    file: string;
    data: Uint8Array;
  }
  interface GifsicleOptions {
    input: GifsicleInput[];
    command: string[];
  }
  const gifsicle: {
    run(options: GifsicleOptions): Promise<Uint8Array[]>;
  };
  export default gifsicle;
}
