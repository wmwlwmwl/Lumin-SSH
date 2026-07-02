package mcpserver

import "fmt"

func requireSearchReplaceOperations(arguments map[string]any, name string) ([]SearchReplaceOperation, error) {
	rawValue, ok := arguments[name]
	if !ok {
		return nil, fmt.Errorf("missing required argument: %s", name)
	}
	rawItems, ok := rawValue.([]any)
	if !ok {
		return nil, fmt.Errorf("argument %s must be an array", name)
	}
	if len(rawItems) == 0 {
		return nil, fmt.Errorf("argument %s must contain at least one operation", name)
	}
	operations := make([]SearchReplaceOperation, 0, len(rawItems))
	for index, rawItem := range rawItems {
		itemMap, ok := rawItem.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("argument %s[%d] must be an object", name, index)
		}
		if err := validateAllowedArguments(itemMap, "search", "replace"); err != nil {
			return nil, fmt.Errorf("argument %s[%d] %s", name, index, err.Error())
		}
		search, err := requireStringArgumentAllowEmpty(itemMap, "search")
		if err != nil {
			return nil, fmt.Errorf("argument %s[%d] %s", name, index, err.Error())
		}
		replace, err := requireStringArgumentAllowEmpty(itemMap, "replace")
		if err != nil {
			return nil, fmt.Errorf("argument %s[%d] %s", name, index, err.Error())
		}
		operations = append(operations, SearchReplaceOperation{
			Search: search,
			Replace: replace,
		})
	}
	return operations, nil
}