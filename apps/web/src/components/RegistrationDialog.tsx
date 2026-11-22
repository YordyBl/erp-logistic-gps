import { CircleCheck } from 'lucide-react';

import { Button } from './ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';

/** Confirmación modal tras registrar un elemento. `message` nulo la mantiene cerrada. */
export function RegistrationDialog({ title, message, onClose }: {
  readonly title: string;
  readonly message: string | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={message !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          <CircleCheck className="size-10 text-primary" aria-hidden="true" />
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" className="w-full" onClick={onClose}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
