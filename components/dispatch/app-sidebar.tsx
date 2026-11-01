"use client";

import type { ReactNode } from "react";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupActions,
  SidebarGroupAction,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  type SidebarProps,
} from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { useIcons } from "@/lib/icon-context";
import { SidebarWorkspaceHeader } from "@/components/sidebar-app/workspace-header";
import { SidebarUserFooter } from "@/components/sidebar-app/user-footer";
import { SidebarSearchField } from "@/components/sidebar-app/search-field";

export interface NavEntry {
  key: string;
  label: string;
  /** unread → filled dot and bold label; idle → ring. */
  status: "active" | "unread" | "idle";
  lead?: ReactNode;
  count?: number;
  selected?: boolean;
}

export interface DispatchSidebarProps extends Omit<SidebarProps, "children"> {
  serverName: string;
  serverTile: ReactNode;
  servers: { id: string; name: string }[];
  activeServer: string;
  onServer: (id: string) => void;
  onNewServer: () => void;
  onServerSettings: () => void;
  onSearch: () => void;
  unread: number;
  pinned: number;
  activeView: string;
  onView: (view: string) => void;
  channels: NavEntry[];
  dms: NavEntry[];
  groups: NavEntry[];
  onChannel: (key: string) => void;
  onDm: (key: string) => void;
  onGroup: (key: string) => void;
  onNewChannel: () => void;
  channelMenu: (key: string) => ReactNode;
  user: { name: string; avatar: ReactNode };
  userMenu: ReactNode;
  onSettings: () => void;
  onTheme: () => void;
  extra?: ReactNode;
  callStrip?: ReactNode;
}

export function DispatchSidebar({
  serverName,
  serverTile,
  servers,
  activeServer,
  onServer,
  onNewServer,
  onServerSettings,
  onSearch,
  unread,
  pinned,
  activeView,
  onView,
  channels,
  dms,
  groups,
  onChannel,
  onDm,
  onGroup,
  onNewChannel,
  channelMenu,
  user,
  userMenu,
  onSettings,
  onTheme,
  extra,
  callStrip,
  ...props
}: DispatchSidebarProps) {
  const icons = useIcons();
  const PlusIcon = icons.plus;
  const InboxIcon = icons.inbox;
  const StarIcon = icons.star;
  const SettingsIcon = icons.settings;
  const MoonIcon = icons.moon;
  const MoreIcon = icons["more-vertical"];
  const UsersIcon = icons.users;
  const checked = Math.max(0, servers.findIndex((s) => s.id === activeServer));

  const badge = (n?: number) =>
    n ? (
      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{n}</span>
    ) : null;

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarWorkspaceHeader
          name={serverName}
          tile={serverTile}
          checkedIndex={checked}
          menu={
            <>
              {servers.map((s, i) => (
                <MenuItem
                  key={s.id}
                  index={i}
                  label={s.name}
                  checked={s.id === activeServer}
                  onSelect={() => onServer(s.id)}
                />
              ))}
              <MenuItem
                index={servers.length}
                icon={PlusIcon}
                label="Create or join a server"
                onSelect={onNewServer}
              />
              <MenuItem
                index={servers.length + 1}
                icon={SettingsIcon}
                label="Server settings"
                onSelect={onServerSettings}
              />
            </>
          }
        />
        <div className="flex flex-col gap-0.5">
          <div onClick={onSearch} className="cursor-text">
            <SidebarSearchField readOnly placeholder="Search…" shortcut="Ctrl K" />
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={InboxIcon}
                isActive={activeView === "unread"}
                onClick={() => onView("unread")}
              >
                Unread
                {badge(unread)}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={StarIcon}
                isActive={activeView === "pinned"}
                onClick={() => onView("pinned")}
              >
                Pinned
                {badge(pinned)}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={UsersIcon}
                isActive={activeView === "files"}
                onClick={() => onView("files")}
              >
                Files
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup collapsible>
          <SidebarGroupLabel>Channels</SidebarGroupLabel>
          <SidebarGroupActions>
            <Tooltip content="New channel" side="top">
              <SidebarGroupAction aria-label="New channel" onClick={onNewChannel}>
                <PlusIcon />
              </SidebarGroupAction>
            </Tooltip>
          </SidebarGroupActions>
          <SidebarMenu>
            {channels.map((c) => (
              <SidebarMenuItem key={c.key}>
                <SidebarMenuButton status={c.status} isActive={c.selected} onClick={() => onChannel(c.key)}>
                  <span className="text-muted-foreground">#</span> {c.label}
                  {badge(c.count)}
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownTrigger
                    render={
                      <SidebarMenuAction showOnHover aria-label="Channel options">
                        <MoreIcon />
                      </SidebarMenuAction>
                    }
                  />
                  <DropdownContent className="min-w-0 w-[220px]" align="start" sideOffset={4}>
                    {channelMenu(c.key)}
                  </DropdownContent>
                </DropdownMenu>
              </SidebarMenuItem>
            ))}
            {!channels.length && (
              <p className="px-2 py-1 text-[12px] text-muted-foreground">No channels yet.</p>
            )}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup collapsible>
          <SidebarGroupLabel>Direct messages</SidebarGroupLabel>
          <SidebarMenu>
            {dms.map((d) => (
              <SidebarMenuItem key={d.key}>
                <SidebarMenuButton status={d.status} isActive={d.selected} onClick={() => onDm(d.key)}>
                  <span className="flex min-w-0 items-center gap-2">
                    {d.lead}
                    <span className="truncate">{d.label}</span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {!dms.length && (
              <p className="px-2 py-1 text-[12px] text-muted-foreground">
                Direct messages show up here.
              </p>
            )}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup collapsible>
          <SidebarGroupLabel>Group chats</SidebarGroupLabel>
          <SidebarMenu>
            {groups.map((g) => (
              <SidebarMenuItem key={g.key}>
                <SidebarMenuButton status={g.status} isActive={g.selected} onClick={() => onGroup(g.key)}>
                  <span className="flex min-w-0 items-center gap-2">
                    {g.lead}
                    <span className="truncate">{g.label}</span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {!groups.length && (
              <p className="px-2 py-1 text-[12px] text-muted-foreground">
                Group chats show up here.
              </p>
            )}
          </SidebarMenu>
        </SidebarGroup>
        {extra}
      </SidebarContent>

      {callStrip}
      <SidebarFooter>
        <div className="flex items-center gap-1 pr-1.5">
          <SidebarUserFooter
            name={user.name}
            avatar={user.avatar}
            className="min-w-0 flex-1"
            menu={userMenu}
          />
          <Tooltip content="Settings" side="top">
            <button
              type="button"
              aria-label="Settings"
              onClick={onSettings}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
            >
              <SettingsIcon size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
          <Tooltip content="Theme" side="top">
            <button
              type="button"
              aria-label="Theme"
              onClick={onTheme}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
            >
              <MoonIcon size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
