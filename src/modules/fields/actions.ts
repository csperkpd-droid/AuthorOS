"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { NewFieldInput } from "./schemas";
import { createFieldDefinition, deleteFieldDefinition, setFieldValue } from "./service";

export async function createFieldAction(input: NewFieldInput) {
  return runAction(async () => createFieldDefinition(await requireAuthorContext(), input));
}

export async function deleteFieldAction(id: string) {
  return runAction(async () => deleteFieldDefinition(await requireAuthorContext(), id));
}

export async function setFieldValueAction(nodeId: string, fieldId: string, value: string) {
  return runAction(
    async () => setFieldValue(await requireAuthorContext(), nodeId, fieldId, value),
    {
      refresh: false,
    },
  );
}
