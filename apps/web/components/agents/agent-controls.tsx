"use client";

import { forwardRef, type ComponentProps } from "react";
import { ManageRow, type ManageTabIcon } from "@/components/ui/manage-page";
import { BotIcon } from "@/components/animated-icons";
import { Button } from "@/components/ui/button";
import { useActionIconAnimation } from "@/components/chat/messages/use-action-icon-animation";

/** Use the same whole-button hover/focus contract as chat actions. */
export const AgentButton = forwardRef<HTMLButtonElement, ComponentProps<typeof Button> & { icon?: ManageTabIcon }>(function AgentButton({ icon: Icon, children, ...props }, buttonRef) {
  const animation = useActionIconAnimation(Boolean(props.disabled));
  return <Button ref={buttonRef} {...props} {...animation.handlers}>
    {Icon ? <Icon ref={animation.ref} size={16} aria-hidden /> : null}{children}
  </Button>;
});

export function AgentListRow(props: ComponentProps<typeof ManageRow>) {
  const animation = useActionIconAnimation();
  return <div {...animation.handlers}><ManageRow {...props} icon={<BotIcon ref={animation.ref} size={17} aria-hidden />} /></div>;
}
