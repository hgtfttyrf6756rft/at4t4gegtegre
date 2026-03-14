import React, { useState, useRef, useEffect, useCallback } from 'react';

interface SpreadsheetTableProps {
    columns: string[];
    rows: string[][];
    onColumnsChange: (columns: string[]) => void;
    onRowsChange: (rows: string[][]) => void;
    isDarkMode?: boolean;
    title?: string;
    description?: string;
}

// Convert column index to letter (0 = A, 1 = B, 26 = AA, etc.)
const getColumnLabel = (index: number): string => {
    let label = '';
    let n = index;
    while (n >= 0) {
        label = String.fromCharCode((n % 26) + 65) + label;
        n = Math.floor(n / 26) - 1;
    }
    return label;
};

export const SpreadsheetTable: React.FC<SpreadsheetTableProps> = ({
    columns,
    rows,
    onColumnsChange,
    onRowsChange,
    isDarkMode = false,
    title,
    description,
}) => {
    const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
    const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [editingHeader, setEditingHeader] = useState<number | null>(null);
    const [headerEditValue, setHeaderEditValue] = useState('');
    const [draggingColumn, setDraggingColumn] = useState<number | null>(null);
    const [draggingRow, setDraggingRow] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
    const headerInputRef = useRef<HTMLInputElement>(null);
    const tableRef = useRef<HTMLDivElement>(null);

    // Focus input when entering edit mode
    useEffect(() => {
        if (editingCell && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingCell]);

    useEffect(() => {
        if (editingHeader !== null && headerInputRef.current) {
            headerInputRef.current.focus();
            headerInputRef.current.select();
        }
    }, [editingHeader]);

    const handleCellClick = useCallback((row: number, col: number) => {
        setSelectedCell({ row, col });
        setEditingCell(null);
        setEditingHeader(null);
    }, []);

    const handleCellDoubleClick = useCallback((row: number, col: number) => {
        setSelectedCell({ row, col });
        setEditingCell({ row, col });
        setEditValue(rows[row]?.[col] || '');
    }, [rows]);

    const handleHeaderDoubleClick = useCallback((col: number) => {
        setEditingHeader(col);
        setHeaderEditValue(columns[col] || '');
        setSelectedCell(null);
        setEditingCell(null);
    }, [columns]);

    const commitCellEdit = useCallback(() => {
        if (editingCell) {
            const newRows = rows.map((row, rIdx) =>
                rIdx === editingCell.row
                    ? row.map((cell, cIdx) => (cIdx === editingCell.col ? editValue : cell))
                    : row
            );
            onRowsChange(newRows);
            setEditingCell(null);
        }
    }, [editingCell, editValue, rows, onRowsChange]);

    const commitHeaderEdit = useCallback(() => {
        if (editingHeader !== null) {
            const newColumns = columns.map((col, idx) =>
                idx === editingHeader ? headerEditValue : col
            );
            onColumnsChange(newColumns);
            setEditingHeader(null);
        }
    }, [editingHeader, headerEditValue, columns, onColumnsChange]);

    const cancelEdit = useCallback(() => {
        setEditingCell(null);
        setEditingHeader(null);
    }, []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (editingCell) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitCellEdit();
                // Move to next row
                if (editingCell.row < rows.length - 1) {
                    const nextRow = editingCell.row + 1;
                    setSelectedCell({ row: nextRow, col: editingCell.col });
                    setEditingCell({ row: nextRow, col: editingCell.col });
                    setEditValue(rows[nextRow]?.[editingCell.col] || '');
                } else {
                    setSelectedCell({ row: editingCell.row, col: editingCell.col });
                }
            } else if (e.key === 'Tab') {
                e.preventDefault();
                commitCellEdit();
                // Move to next column
                const nextCol = e.shiftKey
                    ? Math.max(0, editingCell.col - 1)
                    : Math.min(columns.length - 1, editingCell.col + 1);
                setSelectedCell({ row: editingCell.row, col: nextCol });
                setEditingCell({ row: editingCell.row, col: nextCol });
                setEditValue(rows[editingCell.row]?.[nextCol] || '');
            } else if (e.key === 'Escape') {
                cancelEdit();
            }
        } else if (editingHeader !== null) {
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                commitHeaderEdit();
            } else if (e.key === 'Escape') {
                cancelEdit();
            }
        } else if (selectedCell) {
            const { row, col } = selectedCell;
            if (e.key === 'ArrowUp' && row > 0) {
                e.preventDefault();
                setSelectedCell({ row: row - 1, col });
            } else if (e.key === 'ArrowDown' && row < rows.length - 1) {
                e.preventDefault();
                setSelectedCell({ row: row + 1, col });
            } else if (e.key === 'ArrowLeft' && col > 0) {
                e.preventDefault();
                setSelectedCell({ row, col: col - 1 });
            } else if (e.key === 'ArrowRight' && col < columns.length - 1) {
                e.preventDefault();
                setSelectedCell({ row, col: col + 1 });
            } else if (e.key === 'Enter' || e.key === 'F2') {
                e.preventDefault();
                setEditingCell({ row, col });
                setEditValue(rows[row]?.[col] || '');
            } else if (e.key === 'Tab') {
                e.preventDefault();
                const nextCol = e.shiftKey ? Math.max(0, col - 1) : Math.min(columns.length - 1, col + 1);
                setSelectedCell({ row, col: nextCol });
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                const newRows = rows.map((r, rIdx) =>
                    rIdx === row ? r.map((c, cIdx) => (cIdx === col ? '' : c)) : r
                );
                onRowsChange(newRows);
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                // Start typing to edit
                setEditingCell({ row, col });
                setEditValue(e.key);
            }
        }
    }, [editingCell, editingHeader, selectedCell, rows, columns, commitCellEdit, commitHeaderEdit, cancelEdit, onRowsChange]);

    const addRow = useCallback(() => {
        const newRow = new Array(columns.length).fill('');
        onRowsChange([...rows, newRow]);
    }, [columns.length, rows, onRowsChange]);

    const addColumn = useCallback(() => {
        const nextColIndex = columns.length;
        const nextColumns = [...columns, `Column ${getColumnLabel(nextColIndex)}`];
        const nextRows = rows.map(row => {
            const next = [...row];
            next.push('');
            return next;
        });
        onColumnsChange(nextColumns);
        onRowsChange(nextRows);
        setSelectedCell(null);
        setEditingCell(null);
        setEditingHeader(null);
    }, [columns, rows, onColumnsChange, onRowsChange]);

    const deleteRow = useCallback((rowIndex: number) => {
        if (rows.length <= 1) return;
        onRowsChange(rows.filter((_, idx) => idx !== rowIndex));
        setSelectedCell(null);
        setEditingCell(null);
    }, [rows, onRowsChange]);

    const deleteColumn = useCallback((colIndex: number) => {
        if (columns.length <= 1) return;
        onColumnsChange(columns.filter((_, idx) => idx !== colIndex));
        onRowsChange(rows.map(row => row.filter((_, idx) => idx !== colIndex)));
        setSelectedCell(null);
        setEditingCell(null);
    }, [columns, rows, onColumnsChange, onRowsChange]);

    const moveItem = useCallback((list: any[], from: number, to: number): any[] => {
        if (from === to) return list;
        const result = [...list];
        const [item] = result.splice(from, 1);
        result.splice(to, 0, item);
        return result;
    }, []);

    const handleColumnDragStart = useCallback((index: number) => {
        setDraggingColumn(index);
    }, []);

    const handleColumnDrop = useCallback((targetIndex: number) => {
        if (draggingColumn === null || draggingColumn === targetIndex) return;
        const newColumns = moveItem(columns, draggingColumn, targetIndex);
        const newRows = rows.map(row => moveItem(row, draggingColumn, targetIndex));
        onColumnsChange(newColumns);
        onRowsChange(newRows);
        setDraggingColumn(null);
        setSelectedCell(null);
        setEditingCell(null);
    }, [columns, rows, draggingColumn, moveItem, onColumnsChange, onRowsChange]);

    const handleRowDragStart = useCallback((index: number) => {
        setDraggingRow(index);
    }, []);

    const handleRowDrop = useCallback((targetIndex: number) => {
        if (draggingRow === null || draggingRow === targetIndex) return;
        const newRows = moveItem(rows, draggingRow, targetIndex);
        onRowsChange(newRows);
        setDraggingRow(null);
        setSelectedCell(null);
        setEditingCell(null);
    }, [rows, draggingRow, moveItem, onRowsChange]);

    // Styles
    const baseBg = isDarkMode ? 'bg-[#1d1d1f]' : 'bg-white';
    const borderColor = isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200';
    const headerBg = isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-50';
    const cellBg = isDarkMode ? 'bg-[#1d1d1f]' : 'bg-white';
    const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
    const mutedText = isDarkMode ? 'text-[#86868b]' : 'text-gray-500';
    const selectedBorder = 'border-[#0071e3]';
    const selectedBg = isDarkMode ? 'bg-[#0a84ff]/15' : 'bg-[#0071e3]/10';
    const hoverBg = isDarkMode ? 'hover:bg-[#2d2d2f]/50' : 'hover:bg-gray-50';

    return (
        <div className="flex flex-col gap-3">
            {/* Title and Description */}
            {(title || description) && (
                <div className="mb-1">
                    {title && (
                        <h4 className={`text-sm font-semibold ${textColor}`}>{title}</h4>
                    )}
                    {description && (
                        <p className={`text-xs mt-0.5 ${mutedText}`}>{description}</p>
                    )}
                </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                    type="button"
                    onClick={addRow}
                    className={`px-2 py-1 rounded-md flex items-center gap-1 ${isDarkMode ? 'bg-[#2d2d2f] text-white hover:bg-[#3d3d3f]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Row
                </button>
                <button
                    type="button"
                    onClick={addColumn}
                    className={`px-2 py-1 rounded-md flex items-center gap-1 ${isDarkMode ? 'bg-[#2d2d2f] text-white hover:bg-[#3d3d3f]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16m-8-8v16" />
                    </svg>
                    Add Column
                </button>
                <span className={`ml-auto ${mutedText}`}>
                    {rows.length} rows × {columns.length} columns
                </span>
            </div>

            {/* Table */}
            <div
                ref={tableRef}
                className={`overflow-auto rounded-xl border ${borderColor} ${isDarkMode ? 'bg-[#111111]' : 'bg-white'} focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30`}
                tabIndex={0}
                onKeyDown={handleKeyDown}
            >
                <table className="min-w-full border-collapse">
                    {/* Header Row */}
                    <thead>
                        <tr>
                            {/* Row label header */}
                            <th className={`sticky top-0 left-0 z-30 w-14 min-w-[56px] px-2 py-2 text-xs font-medium border-r border-b ${borderColor} ${headerBg} ${mutedText}`}>
                                #
                            </th>
                            {/* Column headers */}
                            {columns.map((col, colIdx) => (
                                <th
                                    key={colIdx}
                                    className={`sticky top-0 z-20 relative group min-w-[80px] px-2 py-2 text-xs font-medium text-left border-b border-r ${borderColor} ${headerBg} ${textColor} cursor-pointer`}
                                    onDragOver={e => e.preventDefault()}
                                    onDrop={e => {
                                        e.preventDefault();
                                        handleColumnDrop(colIdx);
                                    }}
                                    onDoubleClick={() => handleHeaderDoubleClick(colIdx)}
                                >
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            className={`h-3 w-3 flex-shrink-0 rounded-sm border border-transparent text-[9px] leading-none ${isDarkMode ? 'text-[#86868b] hover:border-[#636366] hover:bg-[#2d2d2f]' : 'text-gray-400 hover:border-gray-300 hover:bg-gray-100'} cursor-move`}
                                            draggable
                                            onDragStart={() => handleColumnDragStart(colIdx)}
                                            aria-label="Reorder column"
                                        >
                                            ⋮
                                        </button>
                                        <span className={`text-[10px] font-normal ${mutedText}`}>
                                            {getColumnLabel(colIdx)}
                                        </span>
                                        {editingHeader === colIdx ? (
                                            <input
                                                ref={headerInputRef}
                                                type="text"
                                                value={headerEditValue}
                                                onChange={e => setHeaderEditValue(e.target.value)}
                                                onBlur={commitHeaderEdit}
                                                onKeyDown={handleKeyDown}
                                                className={`flex-1 px-1 py-0.5 text-xs rounded border ${isDarkMode ? 'bg-[#1d1d1f] border-[#0071e3] text-white' : 'bg-white border-[#0071e3] text-gray-900'} focus:outline-none`}
                                            />
                                        ) : (
                                            <span className="flex-1 truncate">{col || 'Label'}</span>
                                        )}
                                        {columns.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); deleteColumn(colIdx); }}
                                                className={`opacity-0 group-hover:opacity-100 p-0.5 rounded ${isDarkMode ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-100 text-red-500'}`}
                                                title="Delete column"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>

                    {/* Data Rows */}
                    <tbody>
                        {rows.map((row, rowIdx) => (
                            <tr key={rowIdx} className="group/row">
                                {/* Row index (numeric only) */}
                                <td
                                    className={`sticky left-0 z-10 w-14 min-w-[56px] px-2 py-1.5 text-xs text-center border-r border-b ${borderColor} ${headerBg} ${mutedText}`}
                                    draggable
                                    onDragStart={() => handleRowDragStart(rowIdx)}
                                    onDragOver={e => e.preventDefault()}
                                    onDrop={e => {
                                        e.preventDefault();
                                        handleRowDrop(rowIdx);
                                    }}
                                >
                                    <div className="flex items-center justify-between gap-1">
                                        <span>{rowIdx + 1}</span>
                                        {rows.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); deleteRow(rowIdx); }}
                                                className={`opacity-0 group-hover/row:opacity-100 p-0.5 rounded ${isDarkMode ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-100 text-red-500'}`}
                                                title="Delete row"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </td>
                                {/* Data cells */}
                                {row.map((cell, colIdx) => {
                                    const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx;
                                    const isEditing = editingCell?.row === rowIdx && editingCell?.col === colIdx;
                                    const zebraBg = isDarkMode
                                        ? (rowIdx % 2 === 0 ? 'bg-[#1d1d1f]' : 'bg-[#19191b]')
                                        : (rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50');

                                    return (
                                        <td
                                            key={colIdx}
                                            className={`${isEditing ? 'min-w-[160px]' : 'min-w-[80px]'} px-1 py-0.5 text-xs border-r border-b ${borderColor} ${cellBg} ${zebraBg} ${textColor} cursor-cell ${!isEditing && hoverBg} ${isSelected && !isEditing ? `ring-2 ring-inset ${selectedBorder} ${selectedBg}` : ''}`}
                                            onClick={() => { if (!isEditing) handleCellClick(rowIdx, colIdx); }}
                                            onDoubleClick={() => { if (!isEditing) handleCellDoubleClick(rowIdx, colIdx); }}
                                        >
                                            {isEditing ? (
                                                <textarea
                                                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                                                    value={editValue}
                                                    onChange={e => setEditValue(e.target.value)}
                                                    onBlur={commitCellEdit}
                                                    onKeyDown={handleKeyDown}
                                                    className={`w-full px-2 py-1 text-xs rounded border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode ? 'bg-[#2d2d2f] text-white' : 'bg-blue-50 text-gray-900'} min-h-[80px] resize-y`}
                                                />
                                            ) : (
                                                <div className="px-2 py-1 min-h-[24px] max-w-[320px] whitespace-pre-wrap break-words line-clamp-3" title={cell}>
                                                    {cell}
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Keyboard shortcuts hint */}
            <div className={`text-[10px] ${mutedText} flex flex-wrap gap-x-4 gap-y-1`}>
                <span>Click to select</span>
                <span>Double-click or type to edit</span>
                <span>Tab to move between cells</span>
                <span>Enter to confirm & move down</span>
                <span>Escape to cancel</span>
                <span>Arrow keys to navigate</span>
            </div>
        </div>
    );
};

export default SpreadsheetTable;
