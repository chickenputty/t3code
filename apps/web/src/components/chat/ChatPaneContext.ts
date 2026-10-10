import { createContext, useContext } from "react";

/**
 * Which chat pane a ChatView renders in. Without a split there is one pane and
 * it is always focused. With a split, window-level handlers (shortcuts, paste
 * to composer, refocus on window focus, preview and menu actions) run only in
 * the focused pane, so one keystroke never acts on two threads.
 */
export interface ChatPaneValue {
  readonly isFocusedPane: boolean;
  /** Set on the secondary pane of a split; the header shows a close button. */
  readonly onClosePane?: (() => void) | undefined;
}

const SINGLE_PANE: ChatPaneValue = { isFocusedPane: true };

export const ChatPaneContext = createContext<ChatPaneValue>(SINGLE_PANE);

export function useChatPane(): ChatPaneValue {
  return useContext(ChatPaneContext);
}
