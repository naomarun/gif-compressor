declare module "gifsicle-wasm-browser" {
  const gifsicle: {
    run(options: Record<string, unknown>): Promise<File[]>;
  };
  export default gifsicle;
}

interface Window {
  gifsicle: {
    run(options: Record<string, unknown>): Promise<File[]>;
  };
}
