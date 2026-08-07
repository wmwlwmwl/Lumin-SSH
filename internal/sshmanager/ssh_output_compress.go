package sshmanager

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const defaultTerminalOutputLineLimit = 500
const defaultTerminalOutputCharacterLimit = 35000

func compressTerminalOutput(input string, lineLimit int, characterLimit int) string {
	processed := normalizeTerminalOutputScreen(input)
	return truncateTerminalOutput(applyRunLengthEncoding(processed), lineLimit, characterLimit)
}

func truncateTerminalOutput(content string, lineLimit int, characterLimit int) string {
	if lineLimit <= 0 && characterLimit <= 0 {
		return content
	}
	if characterLimit > 0 {
		runes := []rune(content)
		if len(runes) > characterLimit {
			beforeLimit := characterLimit / 5
			afterLimit := characterLimit - beforeLimit
			startSection := string(runes[:beforeLimit])
			endSection := string(runes[len(runes)-afterLimit:])
			omittedChars := len(runes) - characterLimit
			return startSection + "\n[..." + intToString(omittedChars) + " characters omitted...]\n" + endSection
		}
	}
	if lineLimit <= 0 {
		return content
	}
	lines := splitLinesKeepNewline(content)
	totalLines := len(lines)
	if totalLines <= lineLimit {
		return content
	}
	beforeLimit := lineLimit / 5
	afterLimit := lineLimit - beforeLimit
	startSection := strings.Join(lines[:beforeLimit], "")
	endSection := strings.Join(lines[totalLines-afterLimit:], "")
	omittedLines := totalLines - lineLimit
	return startSection + "\n[..." + intToString(omittedLines) + " lines omitted...]\n\n" + endSection
}

func applyRunLengthEncoding(content string) string {
	if content == "" {
		return content
	}
	lines := splitLinesKeepNewline(content)
	if len(lines) == 0 {
		return content
	}
	var result strings.Builder
	prevLine := lines[0]
	repeatCount := 0
	flush := func() {
		if repeatCount > 0 {
			compressionDesc := "<previous line repeated " + intToString(repeatCount) + " additional times>\n"
			if len(compressionDesc) < len(prevLine)*(repeatCount+1) {
				result.WriteString(prevLine)
				result.WriteString(compressionDesc)
			} else {
				for i := 0; i <= repeatCount; i++ {
					result.WriteString(prevLine)
				}
			}
			repeatCount = 0
			return
		}
		result.WriteString(prevLine)
	}
	for i := 1; i < len(lines); i++ {
		currentLine := lines[i]
		if currentLine == prevLine {
			repeatCount++
			continue
		}
		flush()
		prevLine = currentLine
	}
	flush()
	return result.String()
}

func normalizeTerminalOutputScreen(input string) string {
	if input == "" {
		return ""
	}
	lines := [][]rune{[]rune{}}
	row := 0
	col := 0
	for index := 0; index < len(input); {
		switch input[index] {
		case '\r':
			col = 0
			index++
		case '\n':
			row++
			col = 0
			ensureTerminalScreenRow(&lines, row)
			index++
		case '\b':
			if col > 0 {
				col--
			}
			index++
		case '\t':
			tabWidth := 4 - (col % 4)
			if tabWidth <= 0 {
				tabWidth = 4
			}
			for step := 0; step < tabWidth; step++ {
				writeTerminalScreenRune(&lines, &row, &col, ' ')
			}
			index++
		case 0x1b:
			consumed := consumeTerminalEscapeSequence(input, index, &lines, &row, &col)
			if consumed <= 0 {
				index++
				continue
			}
			index += consumed
		default:
			if input[index] < 0x20 || input[index] == 0x7f {
				index++
				continue
			}
			ch, size := utf8.DecodeRuneInString(input[index:])
			if ch == utf8.RuneError && size == 1 {
				index++
				continue
			}
			writeTerminalScreenRune(&lines, &row, &col, ch)
			index += size
		}
	}
	lastNonEmpty := len(lines) - 1
	for lastNonEmpty > 0 && len(trimTerminalScreenRightSpaces(lines[lastNonEmpty])) == 0 {
		lastNonEmpty--
	}
	parts := make([]string, 0, lastNonEmpty+1)
	for index := 0; index <= lastNonEmpty; index++ {
		parts = append(parts, string(trimTerminalScreenRightSpaces(lines[index])))
	}
	return strings.Join(parts, "\n")
}

func consumeTerminalEscapeSequence(input string, index int, lines *[][]rune, row *int, col *int) int {
	if index+1 >= len(input) {
		return 1
	}
	switch input[index+1] {
	case '[':
		end := index + 2
		for end < len(input) {
			ch := input[end]
			if ch >= 0x40 && ch <= 0x7e {
				rawParams := input[index+2 : end]
				if strings.HasPrefix(rawParams, "?") || strings.HasPrefix(rawParams, ">") || strings.HasPrefix(rawParams, "!") {
					rawParams = rawParams[1:]
				}
				params := parseTerminalCSIParams(rawParams)
				applyTerminalCSISequence(lines, row, col, ch, params)
				return end - index + 1
			}
			end++
		}
		return len(input) - index
	case ']':
		end := index + 2
		for end < len(input) {
			if input[end] == 0x07 {
				return end - index + 1
			}
			if input[end] == 0x1b && end+1 < len(input) && input[end+1] == '\\' {
				return end - index + 2
			}
			end++
		}
		return len(input) - index
	default:
		return 2
	}
}

func applyTerminalCSISequence(lines *[][]rune, row *int, col *int, final byte, params []int) {
	switch final {
	case 'A':
		moveTerminalScreenCursor(lines, row, col, -terminalCSIParamValue(params, 0, 1), 0)
	case 'B':
		moveTerminalScreenCursor(lines, row, col, terminalCSIParamValue(params, 0, 1), 0)
	case 'C':
		moveTerminalScreenCursor(lines, row, col, 0, terminalCSIParamValue(params, 0, 1))
	case 'D':
		moveTerminalScreenCursor(lines, row, col, 0, -terminalCSIParamValue(params, 0, 1))
	case 'G':
		*col = maxTerminalCursorPosition(terminalCSIParamValue(params, 0, 1) - 1)
		ensureTerminalScreenRow(lines, *row)
	case 'H', 'f':
		targetRow := maxTerminalCursorPosition(terminalCSIParamValue(params, 0, 1) - 1)
		targetCol := maxTerminalCursorPosition(terminalCSIParamValue(params, 1, 1) - 1)
		*row = targetRow
		*col = targetCol
		ensureTerminalScreenRow(lines, *row)
	case 'J':
		mode := terminalCSIParamValue(params, 0, 0)
		if mode == 2 || mode == 3 {
			*lines = [][]rune{[]rune{}}
			*row = 0
			*col = 0
		}
	case 'K':
		eraseTerminalScreenLine(lines, row, col, terminalCSIParamValue(params, 0, 0))
	case 'm':
		return
	}
}

func moveTerminalScreenCursor(lines *[][]rune, row *int, col *int, rowDelta int, colDelta int) {
	*row += rowDelta
	if *row < 0 {
		*row = 0
	}
	ensureTerminalScreenRow(lines, *row)
	*col += colDelta
	if *col < 0 {
		*col = 0
	}
}

func ensureTerminalScreenRow(lines *[][]rune, row int) {
	for len(*lines) <= row {
		*lines = append(*lines, []rune{})
	}
}

func writeTerminalScreenRune(lines *[][]rune, row *int, col *int, ch rune) {
	ensureTerminalScreenRow(lines, *row)
	line := (*lines)[*row]
	if *col > len(line) {
		line = append(line, []rune(strings.Repeat(" ", *col-len(line)))...)
	}
	if *col == len(line) {
		line = append(line, ch)
	} else {
		line[*col] = ch
	}
	(*lines)[*row] = line
	*col++
}

func eraseTerminalScreenLine(lines *[][]rune, row *int, col *int, mode int) {
	ensureTerminalScreenRow(lines, *row)
	line := (*lines)[*row]
	switch mode {
	case 1:
		limit := *col
		if limit > len(line) {
			limit = len(line)
		}
		for index := 0; index < limit; index++ {
			line[index] = ' '
		}
		(*lines)[*row] = trimTerminalScreenRightSpaces(line)
	case 2:
		(*lines)[*row] = []rune{}
		*col = 0
	default:
		if *col < len(line) {
			line = append([]rune{}, line[:*col]...)
		}
		(*lines)[*row] = line
	}
}

func trimTerminalScreenRightSpaces(line []rune) []rune {
	end := len(line)
	for end > 0 && line[end-1] == ' ' {
		end--
	}
	if end == len(line) {
		return line
	}
	return append([]rune(nil), line[:end]...)
}

func parseTerminalCSIParams(raw string) []int {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ";")
	params := make([]int, 0, len(parts))
	for _, part := range parts {
		params = append(params, parseTerminalCSIParam(part, 0))
	}
	return params
}

func parseTerminalCSIParam(raw string, fallback int) int {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	value, err := strconv.Atoi(trimmed)
	if err != nil {
		return fallback
	}
	return value
}

func terminalCSIParamValue(params []int, index int, fallback int) int {
	if index < 0 || index >= len(params) {
		return fallback
	}
	if params[index] == 0 {
		return fallback
	}
	return params[index]
}

func maxTerminalCursorPosition(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func splitLinesKeepNewline(content string) []string {
	if content == "" {
		return []string{}
	}
	lines := strings.SplitAfter(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func intToString(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var digits [20]byte
	index := len(digits)
	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		index--
		digits[index] = '-'
	}
	return string(digits[index:])
}