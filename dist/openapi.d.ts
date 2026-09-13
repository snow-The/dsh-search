interface SpecDoc {
    openapi?: string;
    swagger?: string;
    servers?: {
        url: string;
        [k: string]: unknown;
    }[];
    paths?: Record<string, Record<string, unknown>>;
    components?: {
        securitySchemes?: Record<string, unknown>;
        schemas?: Record<string, unknown>;
    };
    security?: unknown[];
}
interface ResolvedOperation {
    pathTemplate: string;
    method: string;
    operation: Record<string, unknown>;
}
export declare function parseSpec(spec: string | Record<string, unknown>): Promise<SpecDoc>;
export declare function resolveOperation(doc: SpecDoc, operation: string): ResolvedOperation;
export declare function buildRequest(doc: SpecDoc, op: ResolvedOperation, params: Record<string, unknown>, opts?: {
    server?: string;
    auth?: string;
}): {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
};
export declare function formatResult(status: number, headers: Headers, json: unknown): string;
export interface OpenApiCallArgs {
    spec: string | Record<string, unknown>;
    operation: string;
    params?: Record<string, unknown>;
    server?: string;
    auth?: string;
    timeoutMs?: number;
}
export declare function callOpenApi(args: OpenApiCallArgs): Promise<string>;
export {};
