import type { ReactNode } from 'react';
import './stack.less';

interface StackProps {
  children: ReactNode;
}

/** Empile ses enfants verticalement, alignés à gauche. */
export const Stack = ({ children }: StackProps) => (
  <div className="pp-stack">{children}</div>
);
