type WarningOptions = {
  type?: string;
};

export function shouldSuppressWarning(
  warning: string | Error,
  typeOrOptions?: string | WarningOptions,
): boolean {
  const name =
    warning instanceof Error
      ? warning.name
      : typeof typeOrOptions === "string"
        ? typeOrOptions
        : typeOrOptions?.type;
  const message = warning instanceof Error ? warning.message : warning;

  return (
    name === "ExperimentalWarning" &&
    /(?:node:sqlite|SQLite is an experimental feature)/i.test(message)
  );
}

export function installSqliteWarningFilter(): void {
  const emitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((
    warning: string | Error,
    typeOrOptions?: string | WarningOptions,
    ...rest: unknown[]
  ) => {
    if (shouldSuppressWarning(warning, typeOrOptions)) return;
    Reflect.apply(emitWarning, process, [warning, typeOrOptions, ...rest]);
  }) as typeof process.emitWarning;
}
