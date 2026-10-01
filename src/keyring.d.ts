export interface RingKey {
	key: string;
	label: string;
	fp: string;
}

export interface RingState {
	active?: string;
	dry?: Record<string, string>;
	dead?: Record<string, boolean>;
}

export function fingerprint(key: string): string;
export function parseKeyList(text: string): RingKey[];
export function accountOf(label: string): string;
export function pacificDate(now?: Date): string;
export function classifyFailure(status: number, message?: string): "quota" | "dead" | "model" | "other";

export class KeyRing {
	constructor(keys: RingKey[], state?: RingState, clock?: () => Date);
	keys: RingKey[];
	candidates(): RingKey[];
	markGood(fp: string): void;
	markDry(fp: string): void;
	markDead(fp: string): void;
	toState(): Required<RingState>;
	describe(): Array<{ label: string; fp: string; status: string; active: boolean }>;
}
