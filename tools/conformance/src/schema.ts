// Schema rules: the A18 error result against a tool's outputSchema, ParameterSchemaSpec (A5, A6)
// and typed file parameters (A28, A29).

import { Ajv } from 'ajv'

export const ERROR_CODES = [
  'invalid-params',
  'invalid-op',
  'invalid-value',
  'not-found',
  'read-only',
  'unknown-command',
  'command-failed',
  'not-open',
  'draft-required',
  'not-allowed',
  'unsupported',
  'unavailable',
  'failed',
] as const

const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true, validateFormats: false })
const compiled = new WeakMap<object, ReturnType<typeof ajv.compile>>()

/** Problems with `value` against a JSON Schema, empty when it validates. */
export function validateJson(schema: object, value: unknown): string[] {
  let validate = compiled.get(schema)
  if (!validate) {
    try {
      validate = ajv.compile(schema)
    } catch (error) {
      return [`the schema does not compile: ${error instanceof Error ? error.message : String(error)}`]
    }
    compiled.set(schema, validate)
  }
  if (validate(value)) return []
  return (validate.errors ?? []).slice(0, 5).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
}

/** Why `structured` is not an A18 error result, or an empty list when it is one. */
export function a18Problems(structured: Record<string, unknown> | undefined): string[] {
  if (!structured) return ['no structuredContent']
  const error = structured.error as Record<string, unknown> | undefined
  if (!error || typeof error !== 'object') return ['no `error` in structuredContent']
  const problems: string[] = []
  if (!ERROR_CODES.includes(error.code as (typeof ERROR_CODES)[number])) problems.push(`error.code ${JSON.stringify(error.code)} is not an A18 code`)
  if (typeof error.message !== 'string' || !error.message) problems.push('error.message is not a non-empty string')
  if ('index' in error && !(Number.isInteger(error.index) && (error.index as number) >= 0)) problems.push('error.index is not a step index')
  if ('retryable' in error && typeof error.retryable !== 'boolean') problems.push('error.retryable is not a boolean')
  return problems
}

const VALUE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'array', 'object', 'json', 'file'])
const ACCESS = new Set(['read', 'create', 'write'])

/** Problems with one ValueSchemaSpec node (A5), its file typing included (A28). */
function valueProblems(node: unknown, at: string): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [`${at} is not a ValueSchemaSpec object`]
  const spec = node as Record<string, unknown>
  if (Array.isArray(spec.oneOf)) return spec.oneOf.flatMap((branch, index) => valueProblems(branch, `${at}.oneOf[${index}]`))
  const type = spec.type
  if (typeof type !== 'string' || !VALUE_TYPES.has(type)) return [`${at} has type ${JSON.stringify(type)}`]
  if (type === 'array' && spec.items !== undefined) return valueProblems(spec.items, `${at}.items`)
  if (type === 'object') {
    const problems: string[] = []
    if (!('additionalProperties' in spec)) problems.push(`${at} is an object without explicit additionalProperties`)
    if (spec.properties && typeof spec.properties === 'object') {
      for (const [name, child] of Object.entries(spec.properties)) problems.push(...valueProblems(child, `${at}.${name}`))
    }
    return problems
  }
  if (type === 'file') return fileProblems(spec, at)
  return []
}

function fileProblems(spec: Record<string, unknown>, at: string): string[] {
  const problems: string[] = []
  const folder = spec.kind === 'folder'
  if (spec.kind !== undefined && !folder) problems.push(`${at} has kind ${JSON.stringify(spec.kind)}`)
  if (!ACCESS.has(spec.access as string)) problems.push(`${at} has no access read, create or write (A28)`)
  if (folder && spec.access !== 'read') problems.push(`${at} is a folder with access ${JSON.stringify(spec.access)}; folders are read only (A28)`)
  if (!folder) {
    if (!Array.isArray(spec.accept) || spec.accept.length === 0) problems.push(`${at} has no accept list (A28)`)
    else if (spec.accept.some((ext) => typeof ext !== 'string' || ext.startsWith('.') || !ext)) problems.push(`${at} accept lists extensions with a dot or empty (A28)`)
  }
  return problems
}

/** Problems with one JSON Schema property: its file typing as A29 binds it. */
function jsonPropertyProblems(node: unknown, at: string): string[] {
  if (!node || typeof node !== 'object') return [`${at} is not a schema`]
  const spec = node as Record<string, unknown>
  const problems: string[] = []
  if (spec['x-khp-file'] !== undefined) {
    const file = spec['x-khp-file'] as Record<string, unknown>
    if (spec.type !== 'string') problems.push(`${at} carries x-khp-file but is not a string (A29)`)
    problems.push(...fileProblems({ ...file, type: 'file' }, at))
  }
  if (spec.type === 'file') problems.push(`${at} is typed file in JSON Schema; A29 binds it as a string with x-khp-file`)
  for (const key of ['items']) if (spec[key]) problems.push(...jsonPropertyProblems(spec[key], `${at}.${key}`))
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(spec[key])) (spec[key] as unknown[]).forEach((branch, index) => problems.push(...jsonPropertyProblems(branch, `${at}.${key}[${index}]`)))
  }
  if (spec.properties && typeof spec.properties === 'object') {
    for (const [name, child] of Object.entries(spec.properties)) problems.push(...jsonPropertyProblems(child, `${at}.${name}`))
  }
  return problems
}

/**
 * Problems with a command's parameters as `<prefix>_commands` lists them: a ParameterSchemaSpec
 * (A5), or the JSON Schema an MCP binding converts it to (`{ type: "object", properties }`).
 * Anything else, a notation string included, is not a schema (A6).
 */
export function parameterProblems(parameters: unknown, at: string): string[] {
  if (parameters === undefined || parameters === null) return [`${at}: no parameter schema (A6)`]
  if (typeof parameters !== 'object' || Array.isArray(parameters)) return [`${at}: the parameters are ${typeof parameters === 'string' ? 'a text, not a ParameterSchemaSpec' : 'not a schema'} (A5)`]
  const spec = parameters as Record<string, unknown>
  if (spec.type === 'object' && (spec.properties === undefined || typeof spec.properties === 'object')) {
    return Object.entries((spec.properties as Record<string, unknown>) ?? {}).flatMap(([name, child]) => jsonPropertyProblems(child, `${at}.${name}`))
  }
  return Object.entries(spec).flatMap(([name, child]) => valueProblems(child, `${at}.${name}`))
}

/** The parameter schema of one listed command, under the names a kit may use for it. */
export function commandParameters(command: Record<string, unknown>): unknown {
  for (const key of ['parameters', 'inputSchema', 'schema', 'params']) if (key in command) return command[key]
  return undefined
}

type Spec = Record<string, unknown>
const isSpec = (value: unknown): value is Spec => !!value && typeof value === 'object' && !Array.isArray(value)

/** One parameter of a command, from either schema form; `file` when it is typed `file` (A28, A29). */
export interface Parameter {
  name: string
  schema: Spec
  required: boolean
  file?: { access?: unknown; accept: string[]; kind?: unknown }
}

/** The parameters of a ParameterSchemaSpec (A5) or of its JSON Schema form, or none when it is neither. */
export function parametersOf(parameters: unknown): Parameter[] {
  if (!isSpec(parameters)) return []
  if (parameters.type === 'object' && (parameters.properties === undefined || isSpec(parameters.properties))) {
    const required = Array.isArray(parameters.required) ? parameters.required : []
    return Object.entries((parameters.properties as Spec | undefined) ?? {})
      .filter((entry): entry is [string, Spec] => isSpec(entry[1]))
      .map(([name, schema]) => {
        const file = isSpec(schema['x-khp-file']) ? (schema['x-khp-file'] as Spec) : undefined
        return { name, schema, required: required.includes(name), ...(file ? { file: { access: file.access, accept: acceptOf(file), kind: file.kind } } : {}) }
      })
  }
  return Object.entries(parameters)
    .filter((entry): entry is [string, Spec] => isSpec(entry[1]))
    .map(([name, schema]) => ({
      name,
      schema,
      required: schema.required === true,
      ...(schema.type === 'file' ? { file: { access: schema.access, accept: acceptOf(schema), kind: schema.kind } } : {}),
    }))
}

const acceptOf = (spec: Spec) => (Array.isArray(spec.accept) ? spec.accept.filter((ext): ext is string => typeof ext === 'string') : [])

/** Whether a parameter takes free text: a string that is not a file, an enum, or a constant. */
export function isFreeString(parameter: Parameter): boolean {
  const { schema } = parameter
  if (parameter.file || 'enum' in schema || 'const' in schema) return false
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  return types.includes('string')
}

/** The least value a schema takes: its default, its first enum value or constant, else an empty one of its type. */
export function minimalValue(schema: Spec): unknown {
  if ('default' in schema) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if ('const' in schema) return schema.const
  for (const key of ['oneOf', 'anyOf']) {
    const first = Array.isArray(schema[key]) ? (schema[key] as unknown[])[0] : undefined
    if (isSpec(first)) return minimalValue(first)
  }
  const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== 'null') : schema.type
  switch (type) {
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object':
    case 'json':
      return {}
    case 'null':
      return null
    default:
      return ''
  }
}
