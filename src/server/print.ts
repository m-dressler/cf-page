/** State for console printing */
const printState = {
  lastWasTemporary: true,
  encoder: new TextEncoder(),
  clearLineCommand: new TextEncoder().encode("\r\x1b[K"),
};

/** Prints a message to the console with the ability to override it later */
export const print = async (
  message: string,
  temporary = false,
): Promise<void> => {
  if (printState.lastWasTemporary) {
    await Deno.stdout.write(printState.clearLineCommand);
  }
  const toWrite = printState.lastWasTemporary ? message : "\n" + message;
  printState.lastWasTemporary = temporary;
  await Deno.stdout.write(printState.encoder.encode(toWrite));
};

export const printBuildInfo = ({
  warnings,
  errors,
}: {
  warnings: string[];
  errors: Error[];
}) => {
  if (warnings.length) {
    print(`⚠️ ${warnings.length} warnings:
\t- ${warnings.join("\n\t- ")}`);
  }
  if (errors.length) {
    print(`❌ ${errors.length} errors:
\t- ${errors.join("\n\t- ")}`);
  }
};
