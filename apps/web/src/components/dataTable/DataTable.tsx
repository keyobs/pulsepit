import { EmptyState } from '@components/emptyState/EmptyState';
import { cleanClasses } from '@utils/cleanClasses';
import type { ReactNode } from 'react';
import './dataTable.less';

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  mono?: boolean;
}

interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  emptyText: string;
}

export const DataTable = <Row,>({
  columns,
  rows,
  getRowKey,
  emptyText,
}: DataTableProps<Row>) => {
  if (rows.length === 0) return <EmptyState>{emptyText}</EmptyState>;

  return (
    <div className="pp-data-table">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cleanClasses(column.mono && 'mono')}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
