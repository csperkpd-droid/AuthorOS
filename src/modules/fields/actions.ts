"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { NewFieldInput } from "./schemas";
import {
  createFieldDefinition,
  deleteFieldDefinition,
  previewDeleteField,
  setFieldValue,
} from "./service";

export async function createFieldAction(input: NewFieldInput) {
  return runAction(async () => createFieldDefinition(await requireAuthorContext(), input));
}

export async function previewDeleteFieldAction(id: string) {
  return runAction(async () => previewDeleteField(await requireAuthorContext(), id), {
    refresh: false,
  });
}

export async function deleteFieldAction(id: string, token: string) {
  return runAction(async () => deleteFieldDefinition(await requireAuthorContext(), id, token));
}

export async function setFieldValueAction(nodeId: string, fieldId: string, value: string) {
  return runAction(
    async () => setFieldValue(await requireAuthorContext(), nodeId, fieldId, value),
    {
      refresh: false,
    },
  );
}
