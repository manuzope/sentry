import _ from 'lodash';
import PropTypes from 'prop-types';
import React from 'react';
import styled from 'react-emotion';

import {t} from 'app/locale';
import DropdownAutoComplete from 'app/components/dropdownAutoComplete';
import DropdownButton from 'app/components/dropdownButton';
import InputField from 'app/views/settings/components/forms/inputField';
import InlineSvg from 'app/components/inlineSvg';
import Confirm from 'app/components/confirm';

const ItemList = styled('div')`
  display: flex;
  flex-wrap: wrap;
`;

const Item = styled('span')`
  display: inline-block;
  background-color: ${p => p.theme.button.default.background};
  border: 1px solid ${p => p.theme.button.default.border};
  border-radius: ${p => p.theme.button.borderRadius};
  color: ${p => p.theme.button.default.color};
  cursor: default;
  font-size: ${p => p.theme.fontSizeSmall};
  font-weight: 600;
  line-height: 1;
  padding: 0;
  text-transform: none;
  margin-right: 10px;
  margin-bottom: 5px;
`;

const ItemLabel = styled('span')`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  white-space: nowrap;
`;

const ItemIcon = styled('span')`
  padding-left: 10px;
  color: ${p => p.theme.gray2};
  cursor: pointer;

  &:hover {
    color: ${p => p.theme.button.default.color};
  }
`;

const RichListProps = {
  /**
   * Text used for the add item button.
   */
  addButtonText: PropTypes.node,

  /**
   * Configuration for the add item dropdown.
   */
  addDropdown: PropTypes.shape(DropdownAutoComplete.propTypes).isRequired,

  /**
   * Render function to render an item.
   */
  renderItem: PropTypes.func,

  /**
   * Callback invoked when an item is added via the dropdown menu.
   */
  onAddItem: PropTypes.func,

  /**
   * Callback invoked when an item is interacted with.
   */
  onEditItem: PropTypes.func,

  /**
   * Callback invoked when an item is removed.
   */
  onRemoveItem: PropTypes.func,

  /**
   * Properties for the confirm remove dialog. If missing, the item will be
   * removed immediately.
   */
  removeConfirm: PropTypes.object,
};

function getDefinedProps(propTypes, props) {
  return _.pickBy(props, (_prop, key) => key in propTypes);
}

class RichList extends React.PureComponent {
  static propTypes = {
    ...RichListProps,

    /**
     * The list of items to render.
     */
    value: PropTypes.array.isRequired,
  };

  static defaultProps = {
    addButtonText: t('Add Item'),
    renderItem: item => item,
    onAddItem: (item, addItem) => addItem(item),
    onEditItem: () => {},
    onRemoveItem: (item, removeItem) => removeItem(item),
  };

  triggerChange = items => {
    this.props.onChange(items, {});
    this.props.onBlur(items, {});
  };

  addItem = data => {
    const items = [...this.props.value, data];
    this.triggerChange(items);
  };

  updateItem = (data, index) => {
    const items = [...this.props.value];
    items.splice(index, 1, data);
    this.triggerChange(items);
  };

  removeItem = index => {
    const items = [...this.props.value];
    items.splice(index, 1);
    this.triggerChange(items);
  };

  onSelectDropdownItem = item => {
    this.props.onAddItem(item, this.addItem);
  };

  onEditItem = (item, index) => {
    this.props.onEditItem(item, data => this.updateItem(data, index));
  };

  onRemoveItem = (item, index) => {
    this.props.onRemoveItem(item, () => this.removeItem(index));
  };

  renderItem = (item, index) => {
    const removeIcon = (
      <ItemIcon>
        <InlineSvg src="icon-trash" size="12px" />
      </ItemIcon>
    );

    const removeConfirm = this.props.removeConfirm ? (
      <Confirm
        priority="danger"
        confirmText={t('Remove')}
        {...this.props.removeConfirm}
        onConfirm={() => this.onRemoveItem(item, index)}
      >
        {removeIcon}
      </Confirm>
    ) : (
      removeIcon
    );

    return (
      <Item size="small" key={index}>
        <ItemLabel>
          {this.props.renderItem(item)}
          <ItemIcon onClick={() => this.onEditItem(item, index)}>
            <InlineSvg src="icon-settings" size="12px" />
          </ItemIcon>
          {removeConfirm}
        </ItemLabel>
      </Item>
    );
  };

  renderDropdown = () => {
    return (
      <DropdownAutoComplete
        {...this.props.addDropdown}
        alignMenu="left"
        onSelect={this.onSelectDropdownItem}
      >
        {({isOpen}) => (
          <DropdownButton icon="icon-circle-add" isOpen={isOpen} size="small">
            {this.props.addButtonText}
          </DropdownButton>
        )}
      </DropdownAutoComplete>
    );
  };

  render() {
    return (
      <ItemList>
        {this.props.value.map(this.renderItem)}
        {this.renderDropdown()}
      </ItemList>
    );
  }
}

export default class RichListField extends React.PureComponent {
  static propTypes = {
    ...InputField.propTypes,
    ...RichListProps,
  };

  renderRichList = fieldProps => {
    const richListProps = getDefinedProps(RichListProps, this.props);
    const {value, ...props} = fieldProps;

    // We must not render this field until `setValue` has been applied by the
    // model, which is done after the field is mounted for the first time. To
    // check this, we cannot use Array.isArray because the value passed in by
    // the model might actually be an ObservableArray.
    if (typeof value === 'string' || value.length === undefined) {
      return null;
    }

    return <RichList {...props} value={[...value]} {...richListProps} />;
  };

  render() {
    return <InputField {...this.props} field={this.renderRichList} />;
  }
}
