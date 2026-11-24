/*
 * Atributos `pattern`. Los navegadores los compilan con el flag `v`, donde `(`, `)` y `-` deben ir
 * escapados dentro de una clase: si el patrón no compila, se ignora en silencio y no valida nada.
 */
export const PHONE_PATTERN = '[+]?[0-9][0-9 \\(\\)\\-]*';
export const IDENTIFIER_PATTERN = '[A-Za-z0-9]+(-[A-Za-z0-9]+)*';
/** Política de la API para contraseñas: al menos una letra y un dígito; el largo va en `minLength`. */
export const PASSWORD_PATTERN = '(?=.*\\p{L})(?=.*[0-9]).+';
export const PASSWORD_MIN_LENGTH = 10;
