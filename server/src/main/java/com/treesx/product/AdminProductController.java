package com.treesx.product;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/admin/products")
public class AdminProductController {
    private final AdminProductService service;
    public AdminProductController(AdminProductService service) { this.service=service; }
    @GetMapping public java.util.List<AdminDtos.Item> list() { return service.list(); }
    @GetMapping("/{slug}") public AdminDtos.Detail detail(@PathVariable String slug) { return service.detail(slug); }
    @PostMapping @ResponseStatus(HttpStatus.CREATED) public AdminDtos.Detail create(@Valid @RequestBody AdminDtos.Edit edit) {
        return service.save(edit,true);
    }
    @PutMapping("/{slug}") public AdminDtos.Detail update(@PathVariable String slug,@Valid @RequestBody AdminDtos.Edit edit) {
        if (!slug.equals(edit.slug())) throw AdminProductService.error(HttpStatus.BAD_REQUEST,"商品标识不可修改");
        return service.save(edit,false);
    }
    @PostMapping("/preview") public ProductDto preview(@Valid @RequestBody AdminDtos.Edit edit) { return service.preview(edit); }
    @PutMapping("/{slug}/visibility") public AdminDtos.Item visibility(@PathVariable String slug,@Valid @RequestBody AdminDtos.Visibility visibility) {
        return service.visibility(slug,visibility);
    }
}
