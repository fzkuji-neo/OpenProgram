"use client";

import { forwardRef, type ComponentProps } from "react";
import { ManageRow, type ManageTabIcon } from "@/components/ui/manage-page";
import { BotIcon, BrainIcon, PenToolIcon, ZapIcon, WorkflowIcon, type AnimatedNavIconHandle } from "@/components/animated-icons";
import { Button } from "@/components/ui/button";
import { useActionIconAnimation } from "@/components/chat/messages/use-action-icon-animation";

/** Use the same whole-button hover/focus contract as chat actions. */
export const AgentButton = forwardRef<HTMLButtonElement, ComponentProps<typeof Button> & { icon?: ManageTabIcon }>(function AgentButton({ icon: Icon, children, ...props }, buttonRef) {
  const animation = useActionIconAnimation(Boolean(props.disabled));
  return <Button ref={buttonRef} {...props} {...animation.handlers}>
    {Icon ? <Icon ref={animation.ref} size={16} aria-hidden /> : null}{children}
  </Button>;
});

export const AgentRoleIcon = forwardRef<AnimatedNavIconHandle, { roleId: string; size?: number }>(function AgentRoleIcon({ roleId, size = 18 }, ref) {
  const Icon = roleId === "image" ? PenToolIcon : roleId === "decision" ? BrainIcon : roleId === "utility" ? ZapIcon : roleId === "planner" ? WorkflowIcon : BotIcon;
  return <Icon ref={ref} size={size} aria-hidden />;
});

export function AgentListRow({ roleId = "", ...props }: ComponentProps<typeof ManageRow> & { roleId?: string }) {
  const animation = useActionIconAnimation();
  return <div {...animation.handlers}><ManageRow {...props} icon={<AgentRoleIcon ref={animation.ref} roleId={roleId} />} /></div>;
}
