package link

import "encoding/json"

func unmarshalExtra(data []byte, target any, knownFields ...string) (map[string]any, error) {
	if err := json.Unmarshal(data, target); err != nil {
		return nil, err
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	for _, field := range knownFields {
		delete(fields, field)
	}
	if len(fields) == 0 {
		return nil, nil
	}
	return fields, nil
}

func marshalExtra(source any, extra map[string]any) ([]byte, error) {
	data, err := json.Marshal(source)
	if err != nil {
		return nil, err
	}
	if len(extra) == 0 {
		return data, nil
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	for key, value := range extra {
		if _, isKnownField := fields[key]; !isKnownField {
			fields[key] = value
		}
	}
	return json.Marshal(fields)
}

func (page *TransactionsPage) UnmarshalJSON(data []byte) error {
	type wire TransactionsPage
	*page = TransactionsPage{}
	extra, err := unmarshalExtra(data, (*wire)(page), "data", "has_more")
	page.AdditionalFields = extra
	return err
}

func (page TransactionsPage) MarshalJSON() ([]byte, error) {
	type wire TransactionsPage
	return marshalExtra(wire(page), page.AdditionalFields)
}

func (source *Source) UnmarshalJSON(data []byte) error {
	type wire Source
	*source = Source{}
	extra, err := unmarshalExtra(
		data,
		(*wire)(source),
		"id",
		"name",
		"type",
		"capabilities",
		"external_connection",
		"granted_actions",
		"bank_account",
		"card",
	)
	source.AdditionalFields = extra
	return err
}

func (source Source) MarshalJSON() ([]byte, error) {
	type wire Source
	present := make(map[string]any, len(source.AdditionalFields)+1)
	for key, value := range source.AdditionalFields {
		present[key] = value
	}
	if source.GrantedActions != nil {
		present["granted_actions"] = source.GrantedActions
	}
	return marshalExtra(wire(source), present)
}

func (page *SourcesPage) UnmarshalJSON(data []byte) error {
	type wire SourcesPage
	*page = SourcesPage{}
	extra, err := unmarshalExtra(data, (*wire)(page), "data", "has_more")
	page.AdditionalFields = extra
	return err
}

func (page SourcesPage) MarshalJSON() ([]byte, error) {
	type wire SourcesPage
	return marshalExtra(wire(page), page.AdditionalFields)
}

func (balance *Balance) UnmarshalJSON(data []byte) error {
	type wire Balance
	*balance = Balance{}
	extra, err := unmarshalExtra(
		data,
		(*wire)(balance),
		"source_id",
		"type",
		"cash",
		"credit",
		"current",
		"currency",
		"as_of",
	)
	balance.AdditionalFields = extra
	return err
}

func (balance Balance) MarshalJSON() ([]byte, error) {
	type wire Balance
	return marshalExtra(wire(balance), balance.AdditionalFields)
}

func (page *BalancesPage) UnmarshalJSON(data []byte) error {
	type wire BalancesPage
	*page = BalancesPage{}
	extra, err := unmarshalExtra(data, (*wire)(page), "data", "has_more")
	page.AdditionalFields = extra
	return err
}

func (page BalancesPage) MarshalJSON() ([]byte, error) {
	type wire BalancesPage
	return marshalExtra(wire(page), page.AdditionalFields)
}
