import { RuleError } from "@/lib/errors";

/** The file can't be imported; `problems` lists why. Nothing was changed. */
export class ImportFileError extends RuleError {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? "This file can’t be imported.");
    this.name = "ImportFileError";
  }
}
