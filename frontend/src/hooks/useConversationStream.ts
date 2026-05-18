import { useEffect, useState } from "react";
import type { ConversationMessage } from "../../../shared/types";
import {
	subscribeConversation,
	unsubscribeConversation,
} from "./useMultiplexedTerminal";

interface ConversationEventDetail {
	type:
		| "conversation-subscribed"
		| "conversation-unsubscribed"
		| "initial-conversation"
		| "conversation-update";
	sessionId: string;
	ccSessionId?: string | null;
	messages?: ConversationMessage[];
}

interface UseConversationStreamOptions {
	sessionId: string;
	enabled?: boolean;
	token?: string | null;
}

interface UseConversationStreamResult {
	messages: ConversationMessage[];
	isReady: boolean;
	ccSessionId: string | null;
}

export function useConversationStream({
	sessionId,
	enabled = true,
	token,
}: UseConversationStreamOptions): UseConversationStreamResult {
	const [messages, setMessages] = useState<ConversationMessage[]>([]);
	const [isReady, setIsReady] = useState(false);
	const [ccSessionId, setCcSessionId] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled || !sessionId) {
			return;
		}

		setMessages([]);
		setIsReady(false);
		setCcSessionId(null);

		const handler = (ev: Event) => {
			const detail = (ev as CustomEvent<ConversationEventDetail>).detail;
			if (!detail || detail.sessionId !== sessionId) return;

			switch (detail.type) {
				case "conversation-subscribed":
					setCcSessionId(detail.ccSessionId ?? null);
					break;
				case "conversation-unsubscribed":
					break;
				case "initial-conversation":
					setMessages(detail.messages ?? []);
					setIsReady(true);
					break;
				case "conversation-update":
					if (detail.messages && detail.messages.length > 0) {
						setMessages((prev) => [...prev, ...(detail.messages ?? [])]);
					}
					break;
			}
		};

		window.addEventListener("cchub-conversation", handler);
		subscribeConversation(sessionId, token);

		return () => {
			window.removeEventListener("cchub-conversation", handler);
			unsubscribeConversation(sessionId);
		};
	}, [sessionId, enabled, token]);

	return { messages, isReady, ccSessionId };
}
