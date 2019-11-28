# React forms without hassle

## A Simple Form

```tsx
const MyTextComponent = ({ field, ...innerProps }) => {
  return (
    <Input
      value={field.value}
      onBlur={field.touch}
      onChange={ev => field.set(ev.value)}
      {...innerProps}
      className={field.touched ? field.error : ""}
    />
  );
};

const FormComponent = () => {
  const form = useForm(
    {
      id: "",
      name: "",
      description: "",
    },
    {
      validation:
      {
        fields: {
          // This is a validator for a specific field, triggered onchange.
          id: id => !id && "Id is an required field",
        },
        onChange: values => values.name && values.name.length < 1 && "The name needs to have more letters",
        // This is a validator for all the fileds, triggered at submit
        onSubmit: values => !values.name && !values.description && "You need to specify either name or description",
      }
      onSubmit: values => doSomething(values),
    },
  );

  return (
    <form>
      <MyTextComponent field={form.fields.id} />
      <MyTextComponent field={form.fields.name} />
      <MyTextComponent field={form.fields.description} />
    </form>
  );
};
```

## Working with arrays

It also works with arrays.
You can specify individual field validators as well as an validator for the whole array.

```tsx
const List = ({ arrayField }) => {

  const addType = (e) => {
    e.preventDefault();
    arrayField.push({type: ""})
  }

  return (
    <div>
      <button onClick={addType}>Add a new Type</button>
      <ul>
        { arrayField.items.map((val, index) =>
            <li key={index}>
              <MyTextComponent field={val} />
              <button onClick={() => arrayField.remove(index)} />
            </li>)
        }
      </ul>
    </div>
  );
};

const FormComponent = () => {
  const form = useForm(
    {
      id: "",
      name: "",
      description: "",
      list: [{type: ""}]
    },
    {
      validation: {
        fields: {
          id: id => (!id ? "Id is an required field" : undefined),
          list: {
            // Validate the content in the list indiually
            item: {
              // The content is an complex field, add a field validator for the object
              fields: {
                type: {
                  onChange: value => (!value ? "type is required" : undefined),
                }
              }
            }
            onSubmit: (list => (list.length > 10 ? "You can max have 10 listOfObjects": undefined))
          }
        }
      },
      onSubmit: values => doSomething(values),
    },
  );

  return (
    <form>
      <MyTextComponent field={form.fields.id} />
      <MyTextComponent field={form.fields.name} />
      <MyTextComponent field={form.fields.description} />
      <List field={form.fields.listOfObjects} />
    </form>
  );
};
```

## Working with complex object and optional branches

To work with optional sub branches of the form, just add a complex type that can be null.
Use the .set method on the parent field to add/remove the subform part.

```tsx
const MyChildrenComponent = ({ complexField }) => {

  return (
    <div>
      <MyTextComponent field={complexField.foo} />
      <MyTextComponent field={complexField.bar} />
      <MyTextComponent field={complexField.baz} />
    </div>
  );
};

const FormComponent = () => {
  const form = useForm(
    {
      id: "",
      name: "",
      description: "",
      requiredInfo: { foo: "", bar: "", baz: "" }
      extraInfo: null
    },
    {
      validation: {
        fields: {
          requiredInfo: {
            fields: {
              foo: {
                onChange: value => !value && "foo is required",
              }
            },
            onChange: values => !values.bar && !values.baz && "You need to specify either bar or baz",
          },
        }

      },
      onSubmit: values => doSomething(values),
    },
  );

  const addExtraInfo = (e) => {
    e.preventDefault();
    form.value.extraInfo.set({ foo: "", bar: "", baz: "" });
  }

  return (
    <form>
      <MyTextComponent field={form.fields.id} />
      <MyTextComponent field={form.fields.name} />
      <MyTextComponent field={form.fields.description} />
      <MyChildrenComponent field={form.fields.requiredInfo.fields} />
      { form.fields.extraInfo.fields
        ? <MyChildrenComponent field={form.fields.extraInfo.fields} />
        : <button onClick={addExtraInfo}>Add Extra Info</button>
      }
    </form>
  );
};
```

## API reference

TODO when interface is stable

## Notable features

- Async field level validation

## Limitations and todos

- No opiniated way of doing validation (could perhaps support yoi out of the box but without a dependency)
- Arrays must not be used as tuples (same type is assumed on all indexes)
- No debouncing on async validation (should probably be implemented)
- No cancelation of async validation
- Only basic array manipulation supported (push and remove) (implement more when needed)
- No pre-bundled helper components to render fields (formik has it, but it may not be needed)
- No pre-bundled helper components to render validation errors (formik has it, but it may not be needed)
