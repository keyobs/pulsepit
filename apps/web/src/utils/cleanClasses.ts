type ClassPart = string | false | null | undefined;

/** Assemble des noms de classes en ignorant les valeurs vides ou fausses. */
export function cleanClasses(...parts: ClassPart[]): string {
  return parts.filter(Boolean).join(' ');
}
