"use client";

import type { ReactNode } from "react";
import { Dialog } from "./dialog.js";

export interface DrawerProps {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  open: boolean;
  title: ReactNode;
  onClose(): void;
}

export function Drawer({ children, description, footer, onClose, open, title }: DrawerProps) {
  return (
    <Dialog
      className="uh-drawer"
      description={description}
      footer={footer}
      onClose={onClose}
      open={open}
      title={title}
    >
      {children}
    </Dialog>
  );
}
