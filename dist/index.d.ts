export declare const name = "dsh-search";
export declare const inject: string[];
export { looksOffTopic, detectRefusal, EngineBlockedError, runSearchChain } from './websearch.js';
export declare function apply(ctx: any): Promise<void>;
export declare function dispose(): Promise<void>;
